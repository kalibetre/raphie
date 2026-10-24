import { parentPort, workerData } from "node:worker_threads";

import { Bash, type CommandName, getCommandNames, InMemoryFs } from "just-bash";

import {
  type Checkpoint,
  checkpointSchema,
  type ComputeRequest,
  workspaceLimits as limits,
} from "./workspace-protocol.ts";

// Trusted worker code interprets shell syntax. No host filesystem, env or network
// capability is installed. Workers never receive checkpoint database paths.
async function run({ checkpoint, command }: ComputeRequest) {
  const fs = new InMemoryFs({}, { maxTotalBytes: limits.fileBytes });
  await fs.mkdir("/workspace", { recursive: true });
  const entries = checkpointSchema.parse(checkpoint);
  for (const entry of entries
    .filter((e) => e.kind === "directory")
    .sort((a, b) => a.path.length - b.path.length))
    await fs.mkdir(entry.path, { recursive: true });
  for (const entry of entries.filter((e) => e.kind === "file"))
    await fs.writeFile(entry.path, Buffer.from(entry.content, "base64"));
  for (const entry of entries.filter((e) => e.kind === "symlink"))
    await fs.symlink(entry.content, entry.path);
  for (const entry of entries.filter((e) => e.kind !== "symlink")) {
    await fs.chmod(entry.path, entry.mode);
    await fs.utimes(entry.path, new Date(entry.mtime), new Date(entry.mtime));
  }
  const bash = new Bash({
    fs,
    cwd: "/workspace",
    env: {},
    // Native/optional runtimes are deliberately excluded, including sqlite WASM.
    commands: getCommandNames().filter(
      (name) => name !== "sqlite3",
    ) as CommandName[],
    executionLimitProfile: "hardened",
    executionLimits: {
      maxExecutionTimeMs: limits.timeoutMs,
      maxSourceBytes: limits.sourceBytes,
      maxOutputSize: limits.outputBytes + 1,
      maxFileSystemBytes: limits.fileBytes,
      maxLiveBytes: 32 * 1024 * 1024,
      maxStringLength: limits.fileBytes,
      maxCommandCount: 2000,
      maxLoopIterations: 2000,
      maxArrayElements: 4096,
      maxArchiveEntries: limits.entries,
      maxArchiveBytes: limits.fileBytes,
      maxTraversalEntries: limits.entries,
    },
  });
  const output = await bash.exec(command, {
    replaceEnv: true,
    env: { HOME: "/workspace", PATH: "/bin" },
  });
  if (
    Buffer.byteLength(output.stdout) + Buffer.byteLength(output.stderr) >
    limits.outputBytes
  )
    return {
      checkpoint: [],
      result: {
        stdout: "",
        stderr: "Workspace output limit exceeded; files were not changed.",
        exitCode: 1,
        committed: false,
      },
    };
  const result = {
    stdout: Buffer.from(output.stdout)
      .subarray(0, limits.outputBytes)
      .toString("utf8"),
    stderr: Buffer.from(output.stderr)
      .subarray(0, limits.outputBytes)
      .toString("utf8"),
    exitCode: output.exitCode,
    committed: output.exitCode === 0,
  };
  const saved: Checkpoint = [];
  if (result.committed) {
    if (!(await fs.lstat("/workspace")).isDirectory)
      throw new Error("Workspace root must remain a directory.");
    const paths = fs
      .getAllPaths()
      .filter((p) => p === "/workspace" || p.startsWith("/workspace/"));
    if (paths.length > limits.entries)
      throw new Error("Workspace entry limit exceeded.");
    for (const path of paths) {
      const stat = await fs.lstat(path);
      saved.push({
        path,
        kind: stat.isSymbolicLink
          ? "symlink"
          : stat.isDirectory
            ? "directory"
            : "file",
        content: stat.isSymbolicLink
          ? await fs.readlink(path)
          : stat.isFile
            ? Buffer.from(await fs.readFileBuffer(path)).toString("base64")
            : "",
        mode: stat.mode,
        mtime: stat.mtime.getTime(),
      });
    }
    if (Buffer.byteLength(JSON.stringify(saved)) > limits.checkpointBytes)
      throw new Error("Workspace checkpoint limit exceeded.");
  }
  return { checkpoint: saved, result };
}

run(workerData as ComputeRequest).then(
  (response) => parentPort!.postMessage(response),
  () =>
    parentPort!.postMessage({
      checkpoint: [],
      result: {
        stdout: "",
        stderr:
          "Workspace execution exceeded a limit or failed; files were not changed.",
        exitCode: 1,
        committed: false,
      },
    }),
);

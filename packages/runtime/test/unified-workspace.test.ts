import { expect, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BotWorkspace } from "../src/domains/workspaces/infrastructure/bot-workspace.ts";
import { ContainerCli } from "../src/domains/workspaces/infrastructure/container-cli.ts";
import { RuntimeWorkspace } from "../src/domains/workspaces/infrastructure/runtime-workspace.ts";

// These transitions need only epoch reaping, not running guest compute. Real
// native read/write and stale views are exercised by container-runtime.test.ts.
function fenceOnly() {
  return spyOn(ContainerCli.prototype, "run").mockImplementation((args) => {
    if (args[0] !== "ps") throw new Error("Unexpected container startup");
    return "";
  });
}

test("legacy stores merge without losing conflicting paths and remain one workspace across switches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-unified-"));
  const root = join(directory, "workspace");
  let legacy = await BotWorkspace.open(join(root, "checkpoint.sqlite"));
  await legacy.execute("s", "old", "echo virtual > same");
  await legacy.close();
  await mkdir(join(root, "files"));
  await writeFile(join(root, "files", "same"), "native");
  const cli = fenceOnly();
  let workspace = await RuntimeWorkspace.open({
    directory,
    workspaceId: "fixture",
  });
  try {
    expect(
      (
        await workspace.execute(
          "s",
          "merged",
          "cat same; cat .recovered-just-bash/same",
        )
      ).stdout,
    ).toBe("nativevirtual\n");
    await workspace.putFile(
      "/workspace/uploads/" + "a".repeat(64) + "/note",
      new TextEncoder().encode("upload"),
    );
    await workspace.saveSettings({
      ...workspace.settings(),
      provider: "container",
      hostNetworkAcknowledged: true,
    });
    expect(await readFile(join(root, "files", "same"), "utf8")).toBe("native");
    await writeFile(join(root, "files", "from-native"), "persisted");
    await workspace.saveSettings({
      ...workspace.settings(),
      provider: "just-bash",
    });
    expect(
      (
        await workspace.execute(
          "s",
          "native-files",
          "cat from-native; cat uploads/*/note",
        )
      ).stdout,
    ).toBe("persistedupload");
    await workspace.close();
    workspace = await RuntimeWorkspace.open({
      directory,
      workspaceId: "fixture",
    });
    expect(
      (await workspace.execute("s", "restart", "cat from-native")).stdout,
    ).toBe("persisted");
  } finally {
    await workspace.close();
    cli.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});

test("oversized native workspace refuses lightweight switch without changing files or selection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-unified-limit-"));
  const cli = fenceOnly();
  const workspace = await RuntimeWorkspace.open({
    directory,
    workspaceId: "fixture",
  });
  try {
    await workspace.saveSettings({
      ...workspace.settings(),
      provider: "container",
      hostNetworkAcknowledged: true,
    });
    const file = join(directory, "workspace", "files", "large");
    await writeFile(file, new Uint8Array(8 * 1024 * 1024 + 1));
    await assert.rejects(
      workspace.saveSettings({
        ...workspace.settings(),
        provider: "just-bash",
      }),
      /8 MiB/,
    );
    expect(workspace.settings().provider).toBe("container");
    expect((await readFile(file)).length).toBe(8 * 1024 * 1024 + 1);
    await rm(file);
    await symlink("/etc/passwd", file);
    await workspace.saveSettings({
      ...workspace.settings(),
      provider: "just-bash",
    });
    expect((await workspace.list()).items[0]?.kind).toBe("symlink");
  } finally {
    await workspace.close();
    cli.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});

test("interrupted disk publication recovers the committed checkpoint and receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-unified-recovery-"));
  let workspace = await RuntimeWorkspace.open({
    directory,
    workspaceId: "fixture",
  });
  try {
    await workspace.execute("s", "append", "echo once >> count");
    await workspace.close();
    const root = join(directory, "workspace");
    await rename(join(root, "files"), join(root, "files.previous"));
    await mkdir(join(root, "files.next"));
    await writeFile(join(root, "files.next", "count"), "partial");
    workspace = await RuntimeWorkspace.open({
      directory,
      workspaceId: "fixture",
    });
    await workspace.execute("s", "append", "echo once >> count");
    expect(await readFile(join(root, "files", "count"), "utf8")).toBe("once\n");
  } finally {
    await workspace.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("oversized legacy adoption keeps recovery settings available and preserves both sources", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-legacy-limit-"));
  const root = join(directory, "workspace");
  const legacy = await BotWorkspace.open(join(root, "checkpoint.sqlite"));
  await legacy.execute("s", "old", "echo legacy > note");
  await legacy.close();
  await mkdir(join(root, "files"));
  await writeFile(
    join(root, "files", "large"),
    new Uint8Array(8 * 1024 * 1024 + 1),
  );
  const cli = fenceOnly();
  let workspace = await RuntimeWorkspace.open({
    directory,
    workspaceId: "fixture",
  });
  try {
    expect(
      (await workspace.info()).providers.find((p) => p.id === "just-bash")
        ?.available,
    ).toBe(false);
    expect(() => workspace.list()).toThrow("8 MiB");
    await workspace.close();
    // The published recovery folder is recognized on retry rather than nested again.
    workspace = await RuntimeWorkspace.open({
      directory,
      workspaceId: "fixture",
    });
    await workspace.saveSettings({
      ...workspace.settings(),
      provider: "container",
      hostNetworkAcknowledged: true,
    });
    expect(
      await readFile(
        join(root, "files", ".recovered-just-bash", "note"),
        "utf8",
      ),
    ).toBe("legacy\n");
    await rm(join(root, "files", "large"));
    await workspace.saveSettings({
      ...workspace.settings(),
      provider: "just-bash",
    });
    expect(
      (
        await workspace.execute(
          "s",
          "recovered",
          "cat .recovered-just-bash/note",
        )
      ).stdout,
    ).toBe("legacy\n");
  } finally {
    await workspace.close();
    cli.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});

test("repeated publication preserves restricted directory modes without stranding recovery backups", async () => {
  const { removeWorkspaceTree } =
    await import("../src/domains/workspaces/infrastructure/workspace-disk.ts");
  const directory = await mkdtemp(join(tmpdir(), "raphie-workspace-modes-"));
  const options = { directory, workspaceId: "fixture" };
  let workspace = await RuntimeWorkspace.open(options);
  try {
    expect(
      (
        await workspace.execute(
          "s",
          "restrict",
          "mkdir restricted; echo kept > restricted/file; chmod 000 restricted",
        )
      ).committed,
    ).toBe(true);
    for (let n = 0; n < 2; n++) {
      await workspace.close();
      workspace = await RuntimeWorkspace.open(options);
    }
    expect(
      (
        await workspace.execute(
          "s",
          "restore",
          "chmod 755 restricted; cat restricted/file",
        )
      ).stdout,
    ).toBe("kept\n");
  } finally {
    await workspace.close();
    await removeWorkspaceTree(directory);
  }
});

test("legacy checkpoint adoption preserves files under restricted directories", async () => {
  const { removeWorkspaceTree } =
    await import("../src/domains/workspaces/infrastructure/workspace-disk.ts");
  const directory = await mkdtemp(join(tmpdir(), "raphie-legacy-mode-"));
  const legacy = await BotWorkspace.open(
    join(directory, "workspace", "checkpoint.sqlite"),
  );
  await legacy.execute(
    "s",
    "old",
    "mkdir restricted; echo kept > restricted/file; chmod 000 restricted",
  );
  await legacy.close();
  let workspace: RuntimeWorkspace | undefined;
  try {
    workspace = await RuntimeWorkspace.open({
      directory,
      workspaceId: "fixture",
    });
    expect(
      (
        await workspace.execute(
          "s",
          "read",
          "chmod 755 restricted; cat restricted/file",
        )
      ).stdout,
    ).toBe("kept\n");
  } finally {
    await workspace?.close();
    await removeWorkspaceTree(directory);
  }
});

test("interrupted legacy publication recovers when workspace root is restricted", async () => {
  const { migrateCheckpoint, recoverDisk, removeWorkspaceTree } =
    await import("../src/domains/workspaces/infrastructure/workspace-disk.ts");
  const directory = await mkdtemp(join(tmpdir(), "raphie-legacy-root-"));
  const root = join(directory, "workspace");
  const legacy = await BotWorkspace.open(join(root, "checkpoint.sqlite"));
  await legacy.execute("s", "old", "echo kept > file; chmod 000 /workspace");
  await recoverDisk(root);
  const target = legacy.migrationTarget(false);
  await migrateCheckpoint(root, legacy.snapshot(), target);
  await legacy.close();
  let workspace: RuntimeWorkspace | undefined;
  try {
    workspace = await RuntimeWorkspace.open({
      directory,
      workspaceId: "fixture",
    });
    expect(
      (await workspace.execute("s", "read", "chmod 755 /workspace; cat file"))
        .stdout,
    ).toBe("kept\n");
  } finally {
    await workspace?.close();
    await removeWorkspaceTree(directory);
  }
});

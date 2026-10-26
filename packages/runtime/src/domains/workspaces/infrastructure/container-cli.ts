import { spawn, spawnSync } from "node:child_process";

export const containerLimits = {
  timeoutMs: 30_000,
  sourceBytes: 16 * 1024,
  journalEntries: 10_000,
  outputBytes: 32 * 1024,
  rpcBytes: 24 * 1024 * 1024,
  queued: 16,
  concurrent: 4,
  containers: 4,
  memoryBytes: 512 * 1024 * 1024,
  cpus: 1,
  pids: 128,
} as const;

/** Distinguishes runtime outages from corrupt workspace state during startup. */
export class ContainerRuntimeError extends Error {
  override readonly name = "ContainerRuntimeError";
}

/** CLI arguments are always argv, never interpolated into a host shell. */
export class ContainerCli {
  readonly binary: string;

  constructor(binary = process.env.RAPHIE_CONTAINER_BINARY ?? "docker") {
    this.binary = binary;
  }

  run(args: string[]) {
    try {
      const result = spawnSync(this.binary, args, {
        encoding: "utf8",
        timeout: containerLimits.timeoutMs,
        maxBuffer: containerLimits.rpcBytes,
      });
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw new Error(
          `Container CLI ${args[0]} failed: ${result.stderr.trim()}`,
        );
      return result.stdout.trim();
    } catch (error) {
      throw new ContainerRuntimeError(
        `Container runtime ${args[0]} failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  exec(id: string, source: string) {
    return spawn(
      this.binary,
      ["exec", "-i", id, "node", "--input-type=module", "-e", source],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  }

  /** Filtering happens at the daemon BEFORE inspect, stop or removal. */
  owned(workspaceId: string, scope: string) {
    const ids = this.run([
      "ps",
      "-aq",
      "--no-trunc",
      "--filter",
      `label=raphie.workspace=${workspaceId}`,
      "--filter",
      `label=raphie.scope=${scope}`,
    ]);
    return ids ? ids.split(/\s+/) : [];
  }

  inspect(workspaceId: string, scope: string) {
    return this.owned(workspaceId, scope).map(
      (id) =>
        JSON.parse(this.run(["inspect", id]))[0] as {
          Id: string;
          Config: { Labels: Record<string, string> };
        },
    );
  }

  removeOwned(workspaceId: string, scope: string) {
    for (const id of this.owned(workspaceId, scope)) this.run(["rm", "-f", id]);
  }
}

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";

import type { ContainerCli } from "../packages/runtime/src/domains/workspaces/infrastructure/container-cli.ts";
import { ContainerWorkspace } from "../packages/runtime/src/domains/workspaces/infrastructure/container-workspace.ts";
import { computeWorkspace } from "../packages/runtime/src/domains/workspaces/infrastructure/workspace-compute.ts";

if (!Bun.isStandaloneExecutable)
  throw new Error("Run the compiled smoke artifact.");
const result = await computeWorkspace({
  checkpoint: [],
  command: "echo standalone > /workspace/probe; cat /workspace/probe",
});
assert.equal(result.result.stdout, "standalone\n");
assert.equal(result.result.committed, true);

const directory = await mkdtemp(join(tmpdir(), "raphie-standalone-smoke-"));
try {
  // The default check needs no container engine; --container exercises the real guest.
  const realContainer = process.argv.includes("--container");
  const cli = realContainer
    ? undefined
    : ({ removeOwned() {} } as unknown as ContainerCli);
  const workspace = await ContainerWorkspace.open({
    directory,
    workspaceId: `standalone-${crypto.randomUUID()}`,
    idleMinutes: 1,
    diskQuotaMiB: null,
    cli,
  });
  try {
    if (realContainer) {
      let output = "";
      const execution = getOrThrow(
        await workspace.env().exec(
          "echo standalone > probe; cat probe",
          {
            onOutput: (chunk) => {
              output += chunk;
            },
          },
          BACKGROUND_CONTEXT,
        ),
      );
      assert.equal(execution.exitCode, 0);
      assert.equal(output, "standalone\n");
    }
    console.log(
      realContainer
        ? "Embedded worker and container guest execution passed."
        : "Embedded workspace worker and container guest passed.",
    );
  } finally {
    await workspace.close();
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";

import { subscriptionProviders } from "../packages/runtime/src/domains/settings/infrastructure/subscription-sign-ins.ts";
import type { ContainerCli } from "../packages/runtime/src/domains/workspaces/infrastructure/container-cli.ts";
import { ContainerWorkspace } from "../packages/runtime/src/domains/workspaces/infrastructure/container-workspace.ts";
import { computeWorkspace } from "../packages/runtime/src/domains/workspaces/infrastructure/workspace-compute.ts";

if (!Bun.isStandaloneExecutable)
  throw new Error("Run the compiled smoke artifact.");

// Every subscription's sign-in is in the binary: Pi loads the flows by a
// name built at run time, which the compiler cannot follow unless they are
// registered. Each sign-in starts and announces its page, then stops; no
// request leaves this computer.
for (const { id, create } of subscriptionProviders) {
  const oauth = create().auth?.oauth;
  assert.ok(oauth, `${id} has no sign-in`);
  const controller = new AbortController();
  let announced: (url: string) => void = () => {};
  const page = new Promise<string>((resolve) => {
    announced = resolve;
  });
  const login = oauth.login(
    {
      signal: controller.signal,
      notify: (event) => {
        if (event.type === "auth_url") announced(event.url);
      },
      // Asked for a pasted address: wait, and give up when stopped, as
      // the runtime's sign-ins do.
      prompt: ({ signal }) =>
        new Promise<string>((_, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("Stopped")));
        }),
    },
    { getDeviceId: () => crypto.randomUUID(), agentName: "Raphie smoke" },
  );
  const url = await Promise.race([
    page,
    login.then(() => ""),
    Bun.sleep(10_000).then(() => ""),
  ]).catch((error: unknown) => {
    throw new Error(`${id} sign-in failed to start: ${String(error)}`);
  });
  assert.match(url, /^https:\/\//, `${id} sign-in announced no page`);
  // Stopping it closes its local sign-in server.
  controller.abort();
  await login.catch(() => {});
}
console.log("Subscription sign-ins are bundled.");
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

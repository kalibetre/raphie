import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";

import { ContainerWorkspace } from "../src/domains/workspaces/infrastructure/container-workspace.ts";

const provider = await ContainerWorkspace.open({
  directory: process.argv[2]!,
  workspaceId: "crash-fixture",
  idleMinutes: 1,
  diskQuotaMiB: null,
  namePrefix: "raphie-test",
});
const inherited = getOrThrow(
  await provider
    .env()
    .exec(
      'test -z "${RAPHIE_TEST_HOST_SENTINEL-}"',
      { inheritEnv: true },
      BACKGROUND_CONTEXT,
    ),
);
if (inherited.exitCode !== 0)
  throw new Error("Host environment leaked into container");
await provider.execute(
  "crashed-command",
  "echo once >> count; echo began; sleep 100; echo late > late",
  {
    onOutput: () => process.send?.("running"),
  },
  BACKGROUND_CONTEXT,
);

import type { ExecutionEnv } from "@earendil-works/pi-durable/env";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { authorizeContainerDispatch } from "../src/domains/workspaces/infrastructure/container-workspace.ts";
import { chatModel } from "./chat-model.ts";

const model = chatModel({
  tool: { name: "bash", args: { command: "echo once >> native-count" } },
});
const gateway = await Gateway.open({
  directory: process.argv[2],
  containerNamePrefix: "raphie-test",
  models: model.models,
  model: { provider: "fixture", modelId: "history" },
});
await gateway.saveSandboxSettings({
  ...(await gateway.workspace.info()).settings,
  provider: "container",
  hostNetworkAcknowledged: true,
});
const environment = gateway.workspace.env.bind(gateway.workspace);
gateway.workspace.env = (operationId) => {
  const env = environment(operationId);
  return wrap(env);
};

function wrap(env: ExecutionEnv): ExecutionEnv {
  const execute = env.exec.bind(env);
  return new Proxy(env, {
    get(target, key) {
      if (key === authorizeContainerDispatch) {
        const guard = Reflect.get(target, key);
        return (claim: () => Promise<boolean>) => wrap(guard(claim));
      }
      if (key !== "exec") return Reflect.get(target, key);
      return async (...args: Parameters<typeof execute>) => {
        await execute(...args);
        process.send?.("native-command-committed");
        // Die after the native effect, before Pi records its unsafe tool result.
        return new Promise(() => {});
      };
    },
  });
}

await gateway.sessions.submit(gateway.actors.establish("web"), {
  eventId: "native-crash",
  text: "Append once",
});
while (true) {
  for (const approval of (await gateway.toolApprovals.state()).approvals) {
    if (approval.status === "pending")
      await gateway.toolApprovals.decide(
        approval.id,
        "approved",
        "owner",
        "web",
      );
  }
  await Bun.sleep(10);
}

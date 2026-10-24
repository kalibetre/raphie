import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { chatModel } from "./chat-model.ts";

const model = chatModel({
  tool: { name: "workspace_exec", args: { command: "echo once >> note" } },
});
const gateway = await Gateway.open({
  directory: process.argv[2],
  models: model.models,
  model: { provider: "fixture", modelId: "history" },
});
const execute = gateway.workspace.execute.bind(gateway.workspace);
gateway.workspace.execute = async (...args) => {
  await execute(...args);
  console.log("checkpoint-committed");
  // Emulate death after the host commit but before Pi records the tool result.
  return new Promise(() => {});
};
await gateway.sessions.submit(gateway.actors.establish("web"), {
  eventId: "tool-crash",
  text: "Append once",
});
await new Promise(() => {});

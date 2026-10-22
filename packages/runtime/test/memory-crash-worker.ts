import { join } from "node:path";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { RuntimeMemory } from "../src/domains/memory/infrastructure/runtime-memory.ts";
import { chatModel } from "./chat-model.ts";

// This fixture uses only built-in memory; it never opens the real OS key store.
const memory = new RuntimeMemory(join(process.argv[2], "memory.sqlite"), {
  sealMemoryKey: () => null,
  openMemoryKey: () => null,
});
await memory.configure({
  enabled: true,
  provider: "builtin",
  scope: "owner",
  endpoint: "",
  bankId: "",
});
const retain = memory.retain.bind(memory);
memory.retain = async (input) => {
  await retain(input);
  process.stdout.write("memory-written\n");
  await new Promise<void>(() => {});
};
const app = await Gateway.open({
  directory: process.argv[2],
  memory,
  ...chatModel({
    tool: {
      name: "memory_retain",
      args: { content: "Owner prefers jasmine tea", kind: "fact" },
    },
  }),
});
await app.chats.send({
  source: "web",
  eventId: "memory-crash",
  actor: "owner",
  text: "Remember tea",
});
// Keep the worker alive until the test kills it between effect and tool result.
setInterval(() => {}, 1000);

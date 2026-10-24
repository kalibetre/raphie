import { BotWorkspace } from "../src/domains/workspaces/infrastructure/bot-workspace.ts";

const workspace = await BotWorkspace.open(process.argv[2]);
await workspace.execute("session", "committed", "echo exactly-once >> note");
console.log("checkpoint-committed");
void workspace.execute(
  "session",
  "interrupted",
  "echo uncommitted > note; sleep 60",
);
await new Promise((resolve) => setTimeout(resolve, 200));
console.log("compute-started");
await new Promise(() => {});

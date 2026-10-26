import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { BotJobs } from "../src/domains/schedules/infrastructure/bot-jobs.ts";
import { chatModel } from "./chat-model.ts";
const gateway = await Gateway.open({
  directory: process.argv[2],
  deferResume: true,
  ...chatModel({ pause: new Promise(() => {}) }),
});
const actor = gateway.actors.establish("web");
const jobs = BotJobs.open({
  root: gateway.root,
  harness: gateway.harness,
  install: (e) => gateway.install(e),
  busy: async () => false,
  submit: async (input) => {
    if (process.argv[3] === "admitted")
      await gateway.sessions.submitScheduled(actor, input);
    console.log("run-checkpoint-committed");
    return new Promise(() => {});
  },
});
await jobs.add({
  name: "Crash recovery",
  prompt: "Write once",
  everyMinutes: null,
  firstRunAt: Date.now(),
});
await new Promise(() => {});

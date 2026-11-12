import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { TaskId } from "@earendil-works/pi-durable";

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
    if (process.argv[3] === "retry") {
      throw new Error("synthetic private transport detail");
    }
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
if (process.argv[3] === "retry") {
  for (;;) {
    const [run] = (await jobs.runs()).items;
    if (run) {
      const taskId = Number(run.id.slice(4, run.id.lastIndexOf(":"))) as TaskId;
      const task = await gateway.harness.getTask(taskId, context);
      if (task?.state.status === "sleeping") {
        const checkpoint = task.state.checkpoint;
        if (
          checkpoint &&
          typeof checkpoint === "object" &&
          !Array.isArray(checkpoint) &&
          checkpoint.attempts === 1
        ) {
          console.log(`run-checkpoint-committed ${run.id}`);
          break;
        }
      }
    }
    await delay(10);
  }
}
await new Promise(() => {});

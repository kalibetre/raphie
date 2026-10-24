import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { BotJobs } from "../src/domains/schedules/infrastructure/bot-jobs.ts";
import { chatModel } from "./chat-model.ts";

async function until(check: () => Promise<boolean>) {
  for (let n = 0; n < 300; n++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("Scheduled work did not settle.");
}

test("Pi sleeping jobs recover after restart and manual runs reuse the bot's conversation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-jobs-"));
  const open = async () => {
    const gateway = await Gateway.open({
      directory,
      deferResume: true,
      ...chatModel(),
    });
    // Simulate async credential/MCP setup before installing job definitions.
    await delay(40);
    const actor = gateway.actors.establish("web");
    const jobs = BotJobs.open({
      root: gateway.root,
      harness: gateway.harness,
      install: (e) => gateway.install(e),
      busy: async () =>
        (await gateway.chats.state()).turns.some((t) => t.status === "pending"),
      submit: (input) => gateway.sessions.submitScheduled(actor, input),
    });
    gateway.harness.resume();
    return { gateway, jobs };
  };
  let app = await open();
  try {
    const [job] = await app.jobs.add({
      name: "Brief",
      prompt: "Give me a brief",
      everyMinutes: 60,
      firstRunAt: Date.now() + 200,
    });
    await delay(30);
    await app.gateway.close();
    await delay(220);
    app = await open();
    await until(
      async () => (await app.jobs.read())[0].lastStatus === "submitted",
    );
    await until(async () =>
      (await app.gateway.chats.state()).turns.every((t) => t.status === "done"),
    );
    expect((await app.gateway.chats.state()).turns).toHaveLength(1);
    // A delivery, not an owner message: marked, titled by the job, and the
    // model is told to write the reminder (the fixture echoes its input).
    const [delivery] = (await app.gateway.chats.state()).turns;
    expect(delivery.text).toBe("Give me a brief");
    expect(delivery.scheduled).toEqual({ name: "Brief" });
    expect(delivery.answer).toContain('Scheduled job "Brief" is due now');
    expect(delivery.answer).toContain("did not just send this message");
    expect((await app.gateway.chats.state()).conversations[0].title).toBe(
      "Brief",
    );
    const session = (await app.jobs.read())[0].sessionId;
    app.gateway.harness.resume();
    await delay(20);
    expect((await app.gateway.chats.state()).turns).toHaveLength(1);
    await app.jobs.change(job.id, "run");
    await until(
      async () => (await app.gateway.chats.state()).turns.length === 2,
    );
    expect((await app.gateway.chats.state()).conversations).toHaveLength(1);
    expect((await app.jobs.read())[0].sessionId).toBe(session);
    await app.jobs.change(job.id, "disable");
    expect((await app.jobs.read())[0].enabled).toBe(false);
    await app.jobs.change(job.id, "remove");
    expect(await app.jobs.read()).toEqual([]);
  } finally {
    await app.gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("overlapping first runs checkpoint the shared conversation before submitting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-job-overlap-"));
  const gateway = await Gateway.open({ directory, ...chatModel() });
  const release = Promise.withResolvers<void>();
  const submissions: Array<{ sessionId?: string }> = [];
  const jobs = BotJobs.open({
    root: gateway.root,
    harness: gateway.harness,
    install: (extension) => gateway.install(extension),
    busy: async () => false,
    submit: async (input) => {
      submissions.push(input);
      if (submissions.length === 1) await release.promise;
      return { sessionId: "shared-job-conversation" };
    },
  });
  try {
    const [job] = await jobs.add({
      name: "Overlapping brief",
      prompt: "Give me a brief",
      everyMinutes: 60,
      firstRunAt: Date.now() + 86400_000,
    });
    await jobs.change(job.id, "run");
    await until(async () => submissions.length === 1);
    const queued = jobs.change(job.id, "run");
    release.resolve();
    await queued;
    await until(async () => submissions.length === 2);
    expect(submissions[0].sessionId).toBeUndefined();
    expect(submissions[1].sessionId).toBe("shared-job-conversation");
  } finally {
    release.resolve();
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("replacing a sleeping schedule runs the updated prompt once and retires its old timer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-job-update-"));
  const gateway = await Gateway.open({ directory, ...chatModel() });
  const actor = gateway.actors.establish("web");
  const jobs = BotJobs.open({
    root: gateway.root,
    harness: gateway.harness,
    install: (extension) => gateway.install(extension),
    busy: async () => false,
    submit: (input) => gateway.sessions.submitScheduled(actor, input),
  });
  try {
    const [job] = await jobs.add({
      name: "Original",
      prompt: "Old prompt",
      everyMinutes: 60,
      firstRunAt: Date.now() + 300,
    });
    const { retiredTaskId } = await gateway.root.commit(
      (tx) =>
        jobs.update(tx, job.id, {
          prompt: "Updated prompt",
          everyMinutes: null,
          firstRunAt: Date.now() + 30,
        }),
      context,
    );
    await jobs.retire(retiredTaskId);
    await until(
      async () => (await gateway.chats.state()).turns[0]?.status === "done",
    );
    await delay(350);
    const turns = (await gateway.chats.state()).turns;
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe("Updated prompt");
    expect((await jobs.read())[0].enabled).toBe(false);
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { BotJobs } from "../src/domains/schedules/infrastructure/bot-jobs.ts";
import { createScheduleTools } from "../src/domains/schedules/infrastructure/schedule-tools.ts";
import { chatModel } from "./chat-model.ts";

async function until(check: () => Promise<boolean>) {
  for (let n = 0; n < 400; n++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("Scheduled reminder did not settle.");
}

async function open(directory: string, everyMinutes?: number) {
  const offered: string[][] = [];
  const gateway = await Gateway.open({
    directory,
    deferResume: true,
    ...chatModel({
      offeredTools: (names) => offered.push(names),
      tool: {
        name: "schedule_create",
        args: {
          name: "Funny reminder",
          prompt: "Tell me the time and a funny saying.",
          delaySeconds: 2,
          ...(everyMinutes ? { everyMinutes } : {}),
        },
      },
    }),
  });
  const actor = gateway.actors.establish("web");
  const jobs = BotJobs.open({
    root: gateway.root,
    harness: gateway.harness,
    install: (extension) => gateway.install(extension),
    busy: async () =>
      (await gateway.chats.state()).turns.some((t) => t.status === "pending"),
    submit: (input) => gateway.sessions.submit(actor, input),
  });
  gateway.install(createScheduleTools(jobs, gateway.toolApprovals));
  gateway.harness.resume();
  return { gateway, jobs, offered, actor };
}

test("agent reminder waits for approval, survives restart and replies once in the originating conversation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-reminder-"));
  let app = await open(directory);
  try {
    const receipt = await app.gateway.sessions.submit(app.actor, {
      eventId: "remind",
      text: "Remind me with the time and a funny saying in two seconds.",
    });
    await until(
      async () =>
        (await app.gateway.toolApprovals.state()).approvals.length === 1,
    );
    expect(app.offered[0]).toContain("schedule_create");
    expect(await app.jobs.read()).toEqual([]);
    const proposal = (await app.gateway.toolApprovals.state()).approvals[0];
    expect(JSON.parse(proposal.argumentsJson).everyMinutes).toBeNull();
    expect(JSON.parse(proposal.argumentsJson).destination).toBe(
      "This conversation",
    );
    await app.gateway.close();
    app = await open(directory);
    expect((await app.gateway.toolApprovals.state()).approvals).toHaveLength(1);
    await app.gateway.sessions.decide(app.actor, proposal.id, "approved");
    await until(async () => (await app.jobs.read()).length === 1);
    await until(
      async () => (await app.gateway.chats.state()).turns[0].status === "done",
    );
    const [job] = await app.jobs.read();
    expect(job.sessionId).toBe(receipt.sessionId);
    await app.gateway.close();
    app = await open(directory);
    await until(
      async () => (await app.jobs.read())[0].lastStatus === "submitted",
    );
    await until(async () =>
      (await app.gateway.chats.state()).turns.every((t) => t.status === "done"),
    );
    expect((await app.gateway.chats.state()).turns).toHaveLength(2);
    expect((await app.gateway.chats.state()).conversations).toHaveLength(1);
    expect((await app.gateway.chats.state()).turns[1].text).toBe(
      "Tell me the time and a funny saying.",
    );
    expect((await app.jobs.read())[0].enabled).toBe(false);
    app.gateway.harness.resume();
    await delay(60);
    expect((await app.gateway.chats.state()).turns).toHaveLength(2);
    expect(await app.jobs.read()).toHaveLength(1);
  } finally {
    await app.gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an agent can propose recurring work without turning it into a one-time reminder", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-recurring-tool-"));
  const app = await open(directory, 60);
  try {
    await app.gateway.sessions.submit(app.actor, {
      eventId: "hourly",
      text: "Send me a brief every hour.",
    });
    await until(
      async () =>
        (await app.gateway.toolApprovals.state()).approvals.length === 1,
    );
    const proposal = (await app.gateway.toolApprovals.state()).approvals[0];
    expect(JSON.parse(proposal.argumentsJson).everyMinutes).toBe(60);
    await app.gateway.sessions.decide(app.actor, proposal.id, "approved");
    await until(
      async () => (await app.jobs.read())[0]?.lastStatus === "submitted",
    );
    const [job] = await app.jobs.read();
    expect(job.enabled).toBe(true);
    expect(job.nextRunAt).toBeGreaterThan(job.firstRunAt + 3500_000);
  } finally {
    await app.gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejecting an agent's schedule never saves a job", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-rejected-reminder-"));
  const app = await open(directory);
  try {
    await app.gateway.sessions.submit(app.actor, {
      eventId: "reject-reminder",
      text: "Remind me soon.",
    });
    await until(
      async () =>
        (await app.gateway.toolApprovals.state()).approvals.length === 1,
    );
    const proposal = (await app.gateway.toolApprovals.state()).approvals[0];
    await app.gateway.sessions.decide(app.actor, proposal.id, "rejected");
    await until(
      async () => (await app.gateway.chats.state()).turns[0].status === "done",
    );
    expect(await app.jobs.read()).toEqual([]);
  } finally {
    await app.gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

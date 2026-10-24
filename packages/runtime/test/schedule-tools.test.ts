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

async function open(
  directory: string,
  everyMinutes?: number,
  tool?: {
    name: string;
    args: Record<string, string | number | boolean | null>;
  },
) {
  const offered: string[][] = [];
  const gateway = await Gateway.open({
    directory,
    deferResume: true,
    ...chatModel({
      offeredTools: (names) => offered.push(names),
      tool: tool ?? {
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
  gateway.install(createScheduleTools(jobs));
  gateway.harness.resume();
  return { gateway, jobs, offered, actor };
}

test("agent reminder saves without approval, survives restart and replies once in the originating conversation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-reminder-"));
  let app = await open(directory);
  try {
    const receipt = await app.gateway.sessions.submit(app.actor, {
      eventId: "remind",
      text: "Remind me with the time and a funny saying in two seconds.",
    });
    await until(async () => (await app.jobs.read()).length === 1);
    expect(app.offered[0]).toContain("schedule_create");
    expect(app.offered[0]).toContain("schedule_update");
    expect(app.offered[0]).toContain("schedule_delete");
    await until(
      async () => (await app.gateway.chats.state()).turns[0].status === "done",
    );
    expect((await app.gateway.chats.state()).turns[0].answer).toContain(
      '"saved":true',
    );
    expect((await app.gateway.toolApprovals.state()).approvals).toEqual([]);
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
      async () => (await app.jobs.read())[0]?.lastStatus === "submitted",
    );
    const [job] = await app.jobs.read();
    expect(job.everyMinutes).toBe(60);
    expect((await app.gateway.toolApprovals.state()).approvals).toEqual([]);
    expect(job.enabled).toBe(true);
    expect(job.nextRunAt).toBeGreaterThan(job.firstRunAt + 3500_000);
  } finally {
    await app.gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("agent edits and deletes directly; old timers cannot run after replacement or restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-edit-reminder-"));
  let app = await open(directory);
  try {
    const [original] = await app.jobs.add({
      name: "Original",
      prompt: "Old prompt",
      everyMinutes: 60,
      firstRunAt: Date.now() + 300,
    });
    await app.gateway.close();
    app = await open(directory, undefined, {
      name: "schedule_update",
      args: {
        id: original.id,
        name: "Updated",
        prompt: "New prompt",
        delaySeconds: 2,
        everyMinutes: null,
      },
    });
    await app.gateway.sessions.submit(app.actor, {
      eventId: "edit",
      text: "Make it a one-time reminder in two seconds with the new prompt.",
    });
    await until(
      async () => (await app.gateway.chats.state()).turns[0]?.status === "done",
    );
    const [updated] = await app.jobs.read();
    expect((await app.gateway.chats.state()).turns[0].answer).toContain(
      '"updated":true',
    );
    expect(updated.id).toBe(original.id);
    expect(updated.name).toBe("Updated");
    expect(updated.prompt).toBe("New prompt");
    expect(updated.everyMinutes).toBeNull();
    expect(updated.nextRunAt).toBeGreaterThan(original.nextRunAt);
    expect((await app.gateway.toolApprovals.state()).approvals).toEqual([]);
    await delay(400);
    expect((await app.gateway.chats.state()).turns).toHaveLength(1);
    await app.gateway.close();
    app = await open(directory, undefined, {
      name: "schedule_delete",
      args: { id: original.id },
    });
    await app.gateway.sessions.submit(app.actor, {
      eventId: "delete",
      text: "Delete that reminder.",
    });
    await until(
      async () => (await app.gateway.chats.state()).turns[1]?.status === "done",
    );
    expect(await app.jobs.read()).toEqual([]);
    expect((await app.gateway.chats.state()).turns[1].answer).toContain(
      '"deleted":true',
    );
    expect((await app.gateway.toolApprovals.state()).approvals).toEqual([]);
    await app.gateway.close();
    app = await open(directory);
    await delay(2100);
    expect((await app.gateway.chats.state()).turns).toHaveLength(2);
    expect(await app.jobs.read()).toEqual([]);
  } finally {
    await app.gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("schedule tools cannot edit or delete another bot's schedule", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-foreign-schedule-"));
  const owner = await open(join(directory, "owner"));
  let other = await open(join(directory, "other"));
  try {
    const [job] = await owner.jobs.add({
      name: "Private",
      prompt: "Private prompt",
      everyMinutes: 60,
      firstRunAt: Date.now() + 86400_000,
    });
    for (const name of ["schedule_update", "schedule_delete"]) {
      await other.gateway.close();
      other = await open(join(directory, "other"), undefined, {
        name,
        args:
          name === "schedule_update"
            ? { id: job.id, prompt: "Changed" }
            : { id: job.id },
      });
      await other.gateway.sessions.submit(other.actor, {
        eventId: name,
        text: "Change this schedule.",
      });
      await until(async () =>
        (await other.gateway.chats.state()).turns.every(
          (turn) => turn.status === "done",
        ),
      );
      expect(await other.jobs.read()).toEqual([]);
      expect((await owner.jobs.read())[0].prompt).toBe("Private prompt");
      expect((await other.gateway.toolApprovals.state()).approvals).toEqual([]);
    }
  } finally {
    await owner.gateway.close();
    await other.gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

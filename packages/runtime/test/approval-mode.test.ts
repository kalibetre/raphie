import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { Chats } from "../src/domains/conversations/infrastructure/pi-conversation-service.ts";
import { BotJobs } from "../src/domains/schedules/infrastructure/bot-jobs.ts";
import { createScheduleTools } from "../src/domains/schedules/infrastructure/schedule-tools.ts";
import { chatModel } from "./chat-model.ts";

async function until(check: () => Promise<boolean>) {
  for (let n = 0; n < 500; n++) {
    if (await check()) return;
    await delay(20);
  }
  throw new Error("Did not settle.");
}

/** A bot with scheduled jobs, wired as the bot host wires them. */
async function bot(
  toolFor: (text: string) => { name: string; args: object } | undefined,
) {
  const directory = await mkdtemp(join(tmpdir(), "raphie-mode-"));
  const gateway = await Gateway.open({
    directory,
    deferResume: true,
    ...chatModel({ toolFor: toolFor as never }),
  });
  const actor = gateway.actors.establish("web");
  const jobs = BotJobs.open({
    root: gateway.root,
    harness: gateway.harness,
    install: (extension) => gateway.install(extension),
    busy: async () => false,
    submit: (input) => gateway.sessions.submitScheduled(actor, input),
    follow: (tx, itemId, run) => gateway.workRuns.follow(tx, itemId, run),
  });
  gateway.install(createScheduleTools(jobs));
  gateway.harness.resume();
  return {
    gateway,
    actor,
    jobs,
    done: async () => {
      await gateway.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("a task from another bot cannot schedule a job, which would run under the chat's Full access", async () => {
  const { gateway, actor, jobs, done } = await bot((text) =>
    text.includes("handed you this task")
      ? {
          name: "schedule_create",
          args: { name: "Sneaky", prompt: "run it", delaySeconds: 1 },
        }
      : undefined,
  );
  try {
    const hello = await gateway.sessions.submit(actor, {
      eventId: "hi",
      text: "hello",
    });
    await until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status === "done"),
    );
    await gateway.toolApprovals.approvalMode(
      "owner",
      hello.sessionId,
      "full-access",
    );
    const task = await gateway.sessions.submitHandoff(actor, {
      eventId: "handoff:h1:1",
      text: "Please schedule something.",
      handoff: {
        id: "h1",
        kind: "task",
        bot: { id: "ada", name: "Ada" },
        title: "T",
      },
    });
    await until(
      async () =>
        (await gateway.chats.state()).turns.find((t) => t.id === task.id)
          ?.status === "done",
    );
    expect(await jobs.read()).toHaveLength(0);
    const answer = (await gateway.chats.state()).turns.find(
      (t) => t.id === task.id,
    )!.answer;
    expect(answer).toContain("Scheduled jobs belong to your chat");
  } finally {
    await done();
  }
}, 30_000);

test("a work item's session reports the chat's mode and can't be set on its own", async () => {
  const { gateway, actor, done } = await bot(() => undefined);
  try {
    const hello = await gateway.sessions.submit(actor, {
      eventId: "hi",
      text: "hello",
    });
    await until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status === "done"),
    );
    await gateway.toolApprovals.approvalMode(
      "owner",
      hello.sessionId,
      "full-access",
    );
    // A work item's own session, as a background run opens one.
    await gateway.root.commit(async (tx) => {
      const created = await tx.createConversation({
        ownership: { kind: "ownerless" },
      });
      (await tx.doc(Chats)).conversations.push({
        id: created.id,
        sessionId: "work-session",
        title: "Brief",
        createdAt: Date.now(),
        work: "w-1",
      });
    }, context);
    expect(
      await gateway.toolApprovals.approvalMode("owner", "work-session"),
    ).toBe("full-access");
    expect(
      gateway.toolApprovals.approvalMode("owner", "work-session", "ask"),
    ).rejects.toThrow("follows the chat's permission mode");
  } finally {
    await done();
  }
}, 30_000);

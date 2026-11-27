import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { BotJobs } from "../src/domains/schedules/infrastructure/bot-jobs.ts";
import { WorkItems } from "../src/domains/work/infrastructure/work-store.ts";
import { chatModel } from "./chat-model.ts";

async function until(check: () => Promise<boolean>) {
  for (let n = 0; n < 300; n++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("Scheduled work did not settle.");
}

test("Pi sleeping jobs recover after restart; each run happens in the job's item and is posted to the chat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-jobs-"));
  const seen: string[] = [];
  const open = async () => {
    const gateway = await Gateway.open({
      directory,
      deferResume: true,
      ...chatModel({
        userMessages: (messages) =>
          seen.push(
            messages
              .map((m) =>
                typeof m.content === "string"
                  ? m.content
                  : m.content
                      .flatMap((c) => (c.type === "text" ? [c.text] : []))
                      .join(""),
              )
              .join("\n---\n"),
          ),
      }),
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
      follow: (tx, itemId, run) => gateway.workRuns.follow(tx, itemId, run),
    });
    gateway.harness.resume();
    return { gateway, jobs };
  };
  let app = await open();
  const posts = async () =>
    (await app.gateway.chats.state()).turns.filter(
      (t) => t.work?.kind === "result",
    );
  try {
    const [job] = await app.jobs.add({
      name: "Brief",
      prompt: "Give me a brief",
      everyMinutes: 60,
      firstRunAt: Date.now() + 200,
    });
    // The job is a work item.
    const [item] = await app.gateway.work.list({ open: true });
    expect(item?.origin).toEqual({ kind: "job", jobId: job.id });
    expect(item?.title).toBe("Brief");
    expect(item?.nextAt).toBe(job.nextRunAt);
    await delay(30);
    await app.gateway.close();
    await delay(220);
    app = await open();
    await until(async () => (await posts()).length === 1);
    const { conversations, turns } = await app.gateway.chats.state();
    // The run happened in the item's own session, framed as the job's run
    // (the fixture echoes its input).
    const session = conversations.find((c) => c.work === item!.id)!;
    const run = turns.find((t) => t.conversationId === session.id)!;
    expect(run.text).toBe("Give me a brief");
    expect(run.scheduled).toEqual({ name: "Brief" });
    expect(run.answer).toContain('Scheduled job "Brief" is due now');
    // Its answer was posted to the chat as it is, with no model turn there.
    const chat = conversations.find((c) => c.chat)!;
    const [post] = await posts();
    expect(post!.conversationId).toBe(chat.id);
    expect(post!.answer).toBe(run.answer);
    expect(post!.scheduled).toEqual({ name: "Brief" });
    expect(
      turns.filter((t) => t.conversationId === chat.id && t.id !== post!.id),
    ).toEqual([]);
    // The job's run opens the chat at that message.
    const [history] = (await app.jobs.runs()).items;
    expect(history?.sessionId).toBe(chat.sessionId);
    expect(history?.turnId).toBe(post!.id);
    expect((await app.gateway.work.get(item!.id))?.result?.turnId).toBe(
      post!.id,
    );

    // The chat's model knows what was posted: the next request carries it.
    await app.gateway.chats.send({
      source: "web",
      actor: "owner",
      eventId: "after",
      text: "Thanks",
    });
    await until(async () =>
      (await app.gateway.chats.state()).turns.every(
        (t) => t.status !== "pending",
      ),
    );
    expect(seen.at(-1)).toContain(
      'Your scheduled job "Brief" ran in the background, and you posted this message to the owner:',
    );
    expect(seen.at(-1)).toContain('Scheduled job "Brief" is due now');

    // A manual run reuses the item's session and posts once more.
    await app.jobs.change(job.id, "run");
    await until(async () => (await posts()).length === 2);
    expect(
      (await app.gateway.chats.state()).conversations.filter(
        (c) => c.work === item!.id,
      ),
    ).toHaveLength(1);
    // Pausing waits; removing closes the item.
    await app.jobs.change(job.id, "disable");
    expect((await app.gateway.work.get(item!.id))?.status).toBe("waiting");
    await app.jobs.change(job.id, "remove");
    expect(await app.jobs.read()).toEqual([]);
    expect((await app.gateway.work.get(item!.id))?.status).toBe("done");
  } finally {
    await app.gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("a job's run shows as running on its item, and the owner can cancel it there", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-jobs-cancel-"));
  const release = Promise.withResolvers<void>();
  const gateway = await Gateway.open({
    directory,
    ...chatModel({
      pauseOn: { text: "Check the feeds", until: release.promise },
    }),
  });
  const actor = gateway.actors.establish("web");
  const jobs = BotJobs.open({
    root: gateway.root,
    harness: gateway.harness,
    install: (e) => gateway.install(e),
    busy: async () => false,
    submit: (input) => gateway.sessions.submitScheduled(actor, input),
    follow: (tx, itemId, run) => gateway.workRuns.follow(tx, itemId, run),
  });
  try {
    const [job] = await jobs.add({
      name: "Feeds",
      prompt: "Check the feeds",
      everyMinutes: 60,
      firstRunAt: Date.now() + 60 * 60_000,
    });
    const [item] = await gateway.work.list({ open: true });
    await jobs.change(job.id, "run");
    await until(async () => !!(await gateway.work.get(item!.id))?.run?.turnId);
    // Another run of the job waits for this one: Run now is refused.
    await jobs.change(job.id, "run").then(
      () => expect.unreachable(),
      (error: Error) => expect(error.message).toMatch(/still running/),
    );
    await gateway.work.cancel(item!.id);
    await until(async () => !(await gateway.work.get(item!.id))?.run);
    const post = (await gateway.chats.state()).turns.find(
      (t) => t.work?.kind === "result",
    );
    expect(post?.work?.outcome).toBe("cancelled");
    expect(post?.scheduled).toEqual({ name: "Feeds" });
  } finally {
    release.resolve();
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("a job's item changes only with its job, and waits for its own run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-jobs-item-"));
  const gateway = await Gateway.open({ directory, ...chatModel() });
  const actor = gateway.actors.establish("web");
  const jobs = BotJobs.open({
    root: gateway.root,
    harness: gateway.harness,
    install: (e) => gateway.install(e),
    busy: async () => false,
    submit: (input) => gateway.sessions.submitScheduled(actor, input),
    follow: (tx, itemId, run) => gateway.workRuns.follow(tx, itemId, run),
  });
  try {
    const [job] = await jobs.add({
      name: "Digest",
      prompt: "Send the digest",
      everyMinutes: 60,
      firstRunAt: Date.now() + 60 * 60_000,
    });
    const [item] = await gateway.work.list({ open: true });
    // Neither the owner nor the bot changes or starts it apart from the job.
    expect(await gateway.work.change(item!.id, { status: "dropped" })).toMatch(
      /follows a scheduled job/,
    );
    expect(
      await gateway.root.commit(
        (tx) => gateway.workRuns.start(tx, item!.id, "A private brief"),
        context,
      ),
    ).toMatch(/follows a scheduled job/);
    expect((await gateway.work.get(item!.id))?.status).toBe("active");
    // Editing the job's prompt updates the item's notes.
    await gateway.root.commit(
      (tx) => jobs.update(tx, job.id, { prompt: "Send the weekly digest" }),
      context,
    );
    expect((await gateway.work.get(item!.id))?.notes).toBe(
      "Send the weekly digest",
    );
    // While the item has a run, a due run of the job waits for it.
    await gateway.root.commit(async (tx) => {
      const stored = (await tx.doc(WorkItems)).items.find(
        (i) => i.id === item!.id,
      )!;
      stored.run = { id: "held", startedAt: Date.now() };
    }, context);
    await gateway.root.commit(
      (tx) => jobs.update(tx, job.id, { firstRunAt: Date.now() }),
      context,
    );
    await until(
      async () => (await jobs.runs()).items[0]?.waitingForBot === true,
    );
    expect(
      (await gateway.chats.state()).turns.filter((t) => t.scheduled),
    ).toHaveLength(0);
    await gateway.root.commit(async (tx) => {
      const stored = (await tx.doc(WorkItems)).items.find(
        (i) => i.id === item!.id,
      )!;
      delete stored.run;
    }, context);
    // A waiting run checks again every five seconds.
    for (let n = 0; n < 800; n++) {
      const turns = (await gateway.chats.state()).turns;
      if (turns.some((t) => t.work?.kind === "result")) break;
      await delay(10);
    }
    expect(
      (await gateway.chats.state()).turns.some(
        (t) => t.work?.kind === "result",
      ),
    ).toBe(true);
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("a card a job's run shows moves to the chat with its post", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-jobs-cards-"));
  const seen: string[] = [];
  const gateway = await Gateway.open({
    directory,
    ...chatModel({
      toolFor: (text) =>
        text.includes("Give me a brief")
          ? {
              name: "show_card",
              args: {
                kind: "list",
                title: "Needs attention",
                groups: [{ rows: [{ title: "PR #133 updated" }] }],
              },
            }
          : undefined,
      userMessages: (messages) =>
        seen.push(
          messages
            .map((m) =>
              typeof m.content === "string"
                ? m.content
                : m.content
                    .flatMap((c) => (c.type === "text" ? [c.text] : []))
                    .join(""),
            )
            .join("\n---\n"),
        ),
    }),
  });
  const actor = gateway.actors.establish("web");
  const jobs = BotJobs.open({
    root: gateway.root,
    harness: gateway.harness,
    install: (e) => gateway.install(e),
    busy: async () =>
      (await gateway.chats.state()).turns.some((t) => t.status === "pending"),
    submit: (input) => gateway.sessions.submitScheduled(actor, input),
    follow: (tx, itemId, run) => gateway.workRuns.follow(tx, itemId, run),
  });
  try {
    await jobs.add({
      name: "Brief",
      prompt: "Give me a brief",
      everyMinutes: 60,
      firstRunAt: Date.now() + 50,
    });
    const post = async () =>
      (await gateway.chats.state()).turns.find(
        (t) => t.work?.kind === "result",
      );
    await until(async () => !!(await post()));
    const { conversations } = await gateway.chats.state();
    const chat = conversations.find((c) => c.chat)!;
    // The owner sees the card under the post in the chat, and nowhere else.
    const [card] = (await gateway.cards.state()).cards;
    expect((await gateway.cards.state()).cards).toHaveLength(1);
    expect(card).toMatchObject({
      conversationId: chat.id,
      turnId: (await post())!.id,
      card: { title: "Needs attention" },
    });
    const views = await gateway.queries.session(actor, chat.sessionId);
    expect(views.cards?.map((c) => c.turnId)).toEqual([(await post())!.id]);

    // The chat's model reads the card's rows with the post.
    await gateway.chats.send({
      source: "web",
      actor: "owner",
      eventId: "after",
      text: "Thanks",
    });
    await until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status !== "pending"),
    );
    expect(seen.at(-1)).toContain(card!.text);
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("posting one run's result twice posts it once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-jobs-post-"));
  const gateway = await Gateway.open({ directory, ...chatModel() });
  try {
    const input = {
      runKey: "job:t-1",
      work: {
        itemId: "w-1",
        title: "Digest",
        kind: "result" as const,
        outcome: "completed" as const,
      },
      scheduled: { name: "Digest" },
      text: "Here is the digest.",
    };
    const first = await gateway.chats.postWorkResult(input);
    expect(await gateway.chats.postWorkResult(input)).toBe(first);
    expect(
      (await gateway.chats.state()).turns.filter(
        (t) => t.work?.kind === "result",
      ),
    ).toHaveLength(1);
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("runs never name a session; the chat takes them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-job-overlap-"));
  const gateway = await Gateway.open({ directory, ...chatModel() });
  const release = Promise.withResolvers<void>();
  const submissions: object[] = [];
  const jobs = BotJobs.open({
    root: gateway.root,
    harness: gateway.harness,
    install: (extension) => gateway.install(extension),
    busy: async () => false,
    submit: async (input) => {
      submissions.push(input);
      if (submissions.length === 1) await release.promise;
      return { id: "t-1", sessionId: "chat" };
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
    expect(submissions).toHaveLength(2);
    expect(submissions.some((input) => "sessionId" in input)).toBe(false);
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

test("a transient submission failure retries the same one-time event", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-job-retry-"));
  const gateway = await Gateway.open({ directory, ...chatModel() });
  const events: string[] = [];
  const jobs = BotJobs.open({
    root: gateway.root,
    harness: gateway.harness,
    install: (extension) => gateway.install(extension),
    busy: async () => false,
    submit: async (input) => {
      events.push(input.eventId);
      if (events.length === 1) throw new Error("private transport detail");
      return { id: "t-1", sessionId: "retry-session" };
    },
  });
  try {
    await jobs.add({
      name: "Retry",
      prompt: "Remind me",
      everyMinutes: null,
      firstRunAt: Date.now(),
    });
    for (let n = 0; n < 800 && events.length < 2; n++) await delay(10);
    expect(events).toHaveLength(2);
    expect(events[0]).toBe(events[1]);
    await until(async () => (await jobs.read())[0].lastStatus === "submitted");
    expect((await jobs.read())[0].enabled).toBe(false);
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);

test("overdue work visibly waits for a busy bot and starts late once released", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-job-busy-"));
  const gateway = await Gateway.open({ directory, ...chatModel() });
  let busy = true;
  let deliveries = 0;
  const jobs = BotJobs.open({
    root: gateway.root,
    harness: gateway.harness,
    install: (extension) => gateway.install(extension),
    busy: async () => busy,
    submit: async () => {
      deliveries++;
      return { id: "t-1", sessionId: "late-session" };
    },
  });
  try {
    const [job] = await jobs.add({
      name: "Late",
      prompt: "Remind me",
      everyMinutes: null,
      firstRunAt: Date.now() - 120_000,
    });
    await until(
      async () => (await jobs.read())[0].lastRun?.waitingForBot === true,
    );
    expect(deliveries).toBe(0);
    expect((await jobs.read())[0].enabled).toBe(true);
    busy = false;
    for (let n = 0; n < 800 && deliveries === 0; n++) await delay(10);
    expect(deliveries).toBe(1);
    expect((await jobs.read())[0].lastRun?.late).toBe(true);
    expect((await jobs.read())[0].lastRun?.waitingForBot).toBe(false);
    await jobs.change(job.id, "remove");
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);

test("replaced busy work settles even if the old task wakes before retire", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-job-replace-busy-"));
  const gateway = await Gateway.open({ directory, ...chatModel() });
  const jobs = BotJobs.open({
    root: gateway.root,
    harness: gateway.harness,
    install: (extension) => gateway.install(extension),
    busy: async () => true,
    submit: async () => {
      throw new Error("must not submit");
    },
  });
  try {
    const [job] = await jobs.add({
      name: "Waiting",
      prompt: "Wait",
      everyMinutes: null,
      firstRunAt: Date.now(),
    });
    await until(
      async () => (await jobs.runs()).items[0]?.waitingForBot === true,
    );
    await gateway.root.commit(
      (tx) => jobs.update(tx, job.id, { firstRunAt: Date.now() + 86400_000 }),
      context,
    );
    for (
      let n = 0;
      n < 800 && (await jobs.runs()).items[0]?.status !== "interrupted";
      n++
    )
      await delay(10);
    expect((await jobs.runs()).items[0]?.status).toBe("interrupted");
    expect((await jobs.runs()).items[0]?.waitingForBot).toBe(false);
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);

for (const everyMinutes of [null, 60]) {
  test(`unknown submission failures exhaust four attempts for ${everyMinutes === null ? "one-time" : "recurring"} work`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "raphie-job-exhaust-"));
    const gateway = await Gateway.open({ directory, ...chatModel() });
    const events: string[] = [];
    const jobs = BotJobs.open({
      root: gateway.root,
      harness: gateway.harness,
      install: (extension) => gateway.install(extension),
      busy: async () => false,
      submit: async (input) => {
        events.push(input.eventId);
        throw new Error("private transport payload");
      },
    });
    try {
      await jobs.add({
        name: "Failure",
        prompt: "Retry",
        everyMinutes,
        firstRunAt: Date.now(),
      });
      for (
        let n = 0;
        n < 1000 && (await jobs.read())[0]?.lastStatus !== "failed";
        n++
      )
        await delay(10);
      const [job] = await jobs.read();
      const [run] = (await jobs.runs()).items;
      expect(events).toHaveLength(4);
      expect(new Set(events).size).toBe(1);
      expect(job.lastStatus).toBe("failed");
      expect(job.enabled).toBe(everyMinutes !== null);
      if (everyMinutes !== null)
        expect(job.nextRunAt).toBeGreaterThan(Date.now());
      expect(run.failureReason).toBe("unknown");
      expect(run.late).toBe(false);
      expect(JSON.stringify(run)).not.toContain("private transport");
    } finally {
      await gateway.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 15000);
}

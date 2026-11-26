import { Database } from "bun:sqlite";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { Handoff } from "@raphie/contracts";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { Activity } from "../src/domains/activity/infrastructure/pi-activity-journal.ts";
import { ToolApprovals } from "../src/domains/approvals/infrastructure/pi-tool-approvals.ts";
import { Chats } from "../src/domains/conversations/infrastructure/pi-conversation-service.ts";
import { Handoffs } from "../src/domains/handoffs/infrastructure/bot-handoffs.ts";
import { JobRuns } from "../src/domains/schedules/infrastructure/job-runs.ts";
import { chatModel } from "./chat-model.ts";
import { withoutChat } from "./without-chat.ts";

const web = (eventId: string, text = eventId) => ({
  source: "web" as const,
  actor: "owner",
  eventId,
  text,
});

test("everything the owner writes from an app goes to the bot's one chat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-one-chat-"));
  const app = await Gateway.open({ directory, ...chatModel() });
  try {
    const first = await app.chats.send(web("first"));
    const second = await app.chats.send(web("second"));
    assert.equal(second.sessionId, first.sessionId);
    await app.harness.waitForIdle(context);
    const { conversations } = await app.chats.state();
    assert.equal(conversations.length, 1);
    assert.equal(conversations[0]!.chat, true);
    const owner = app.actors.establish("web");
    assert.equal(
      (await app.queries.session(owner, first.sessionId)).session.chat,
      true,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a bot from before chats keeps its latest app conversation as its chat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-one-chat-legacy-"));
  const config = chatModel();
  let app = await Gateway.open({ directory, ...config });
  try {
    // Before chats, every message without a session started a new one.
    const older = await app.chats.send(web("older"));
    await withoutChat(app);
    const latest = await app.chats.send(web("latest"));
    await withoutChat(app);
    // A channel's conversation is newer, but never becomes the app's chat.
    const channel = await app.chats.send({
      ...web("channel"),
      source: "discord",
      discordThreadId: "discord:guild:channel:one",
    });
    await app.harness.waitForIdle(context);
    await app.close();
    app = await Gateway.open({ directory, ...config });
    const chats = (await app.chats.state()).conversations.filter((c) => c.chat);
    assert.deepEqual(
      chats.map((c) => c.sessionId),
      [latest.sessionId],
    );
    assert.notEqual(older.sessionId, latest.sessionId);
    assert.notEqual(channel.sessionId, latest.sessionId);
    // The owner carries on where they last were.
    assert.equal(
      (await app.chats.send(web("next"))).sessionId,
      latest.sessionId,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

const channel = (
  eventId: string,
  conversation: string,
  provider: "telegram" | "discord" = "telegram",
) => ({
  source: provider,
  actor: "owner",
  eventId,
  text: eventId,
  discordThreadId: conversation,
  connectionId: provider === "telegram" ? "telegram:1" : "discord-app",
  discordUserId: "42",
});

test("private channel chats join the chat; groups and server channels keep their own", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-one-chat-channels-"));
  const app = await Gateway.open({ directory, ...chatModel() });
  try {
    const chat = (await app.chats.send(web("app"))).sessionId;
    assert.equal(
      (await app.chats.send(channel("telegram", "telegram:42"))).sessionId,
      chat,
    );
    assert.equal(
      (await app.chats.send(channel("dm", "discord:@me:7", "discord")))
        .sessionId,
      chat,
    );
    const group = (await app.chats.send(channel("group", "telegram:-100")))
      .sessionId;
    const server = (
      await app.chats.send(channel("server", "discord:guild:7", "discord"))
    ).sessionId;
    assert.equal(new Set([chat, group, server]).size, 3);
    // Each reply goes back where its message came from.
    await app.harness.waitForIdle(context);
    const { turns } = await app.chats.state();
    assert.equal(
      turns.find((t) => t.text === "telegram")?.replyTo?.conversation,
      "telegram:42",
    );
    assert.equal(turns.find((t) => t.text === "app")?.replyTo, null);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a private channel chat from before chats moves to the chat; its old session goes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-one-chat-rebind-"));
  const config = chatModel();
  let app = await Gateway.open({ directory, ...config });
  try {
    const telegram = await app.chats.send(channel("before", "telegram:42"));
    await withoutChat(app);
    const latest = await app.chats.send(web("latest"));
    await withoutChat(app);
    await app.harness.waitForIdle(context);
    assert.notEqual(telegram.sessionId, latest.sessionId);
    await app.close();
    app = await Gateway.open({ directory, ...config });
    assert.equal(
      (await app.chats.send(channel("after", "telegram:42"))).sessionId,
      latest.sessionId,
    );
    assert.ok(
      !(await app.chats.state()).conversations.some(
        (c) => c.sessionId === telegram.sessionId,
      ),
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a restart removes sessions from before chats, after a copy of the bot's storage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-one-chat-removal-"));
  const config = chatModel();
  let app = await Gateway.open({ directory, ...config });
  try {
    const old = await app.chats.send(web("old"));
    await withoutChat(app);
    const chat = await app.chats.send(web("chat"));
    const group = await app.chats.send(channel("group", "telegram:-100"));
    await app.harness.waitForIdle(context);
    const before = await app.chats.state();
    const oldId = before.conversations.find(
      (c) => c.sessionId === old.sessionId,
    )!.id;
    // What refers to the old session: its approval mode and a job's run.
    await app.root.commit(async (tx) => {
      (await tx.doc(ToolApprovals)).commandModes = {
        [String(oldId)]: "full-access",
      };
      (await tx.doc(JobRuns)).items.push({
        id: "run-1",
        jobId: "job-1",
        name: "Brief",
        scheduledFor: 1,
        startedAt: 1,
        finishedAt: 2,
        status: "completed",
        sessionId: old.sessionId,
        turnId: before.turns.find((t) => t.conversationId === oldId)!.id,
        acknowledgedAt: null,
      });
    }, context);
    await app.close();

    app = await Gateway.open({ directory, ...config });
    const after = await app.chats.state();
    assert.deepEqual(
      after.conversations.map((c) => c.sessionId).sort(),
      [chat.sessionId, group.sessionId].sort(),
    );
    assert.ok(!after.turns.some((t) => t.conversationId === oldId));
    assert.equal(
      (await app.toolApprovals.state()).commandModes?.[String(oldId)],
      undefined,
    );
    const [run] = (await app.harness.snapshot(JobRuns, context))!.items;
    assert.equal(run?.sessionId, null);
    assert.equal(run?.turnId, null);
    await assert.rejects(
      app.queries.session(app.actors.establish("web"), old.sessionId),
    );
    // The copy was taken before, and holds the old session.
    const backups = await readdir(join(directory, "backups"));
    assert.equal(backups.length, 1);
    assert.ok(holds(join(directory, "backups", backups[0]!), old.sessionId));
    await app.close();

    // Nothing more to remove: no second copy.
    app = await Gateway.open({ directory, ...config });
    assert.equal((await readdir(join(directory, "backups"))).length, 1);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

/** Whether any row of a SQLite file mentions `text`. */
function holds(path: string, text: string) {
  const database = new Database(path, { readonly: true });
  try {
    const tables = database
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      )
      .all();
    return tables.some(({ name }) =>
      database
        .query(`SELECT * FROM "${name}"`)
        .all()
        .some((row) => JSON.stringify(row).includes(text)),
    );
  } finally {
    database.close();
  }
}

test("an archived conversation never becomes the chat over one in use", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-one-chat-archived-"));
  const config = chatModel();
  let app = await Gateway.open({ directory, ...config });
  try {
    // Put away before chats, though written in last.
    const archived = await app.chats.send(web("archived"));
    await withoutChat(app);
    const used = await app.chats.send(web("used"));
    await withoutChat(app);
    await app.harness.waitForIdle(context);
    await app.chats.send({ ...web("later"), sessionId: archived.sessionId });
    await app.harness.waitForIdle(context);
    await app.root.commit(async (tx) => {
      (await tx.doc(Chats)).conversations.find(
        (c) => c.sessionId === archived.sessionId,
      )!.archivedAt = Date.now();
    }, context);
    await app.close();

    app = await Gateway.open({ directory, ...config });
    const { conversations } = await app.chats.state();
    assert.deepEqual(
      conversations.map((c) => [c.sessionId, !!c.chat, !!c.archivedAt]),
      [[used.sessionId, true, false]],
    );
    const listed = await app.queries.sessions(app.actors.establish("web"));
    assert.deepEqual(
      listed.items.map((s) => s.sessionId),
      [used.sessionId],
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a restart keeps sessions with work in progress and handed-off tasks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-one-chat-guards-"));
  const release = Promise.withResolvers<void>();
  let app = await Gateway.open({
    directory,
    ...chatModel({ pause: release.promise }),
  });
  try {
    // A reply still running when the runtime stops.
    const running = await app.chats.send(web("running"));
    await withoutChat(app);
    const chat = await app.chats.send(web("chat"));
    await withoutChat(app);
    await app.root.commit(async (tx) => {
      const state = await tx.doc(Chats);
      // The chat is `chat`; restore it after the helper cleared it.
      for (const c of state.conversations)
        if (c.sessionId === chat.sessionId) c.chat = true;
      // Idle sessions, made without the paused model: one a working handoff
      // reports back to, and a task another bot handed off to this one.
      for (const [sessionId, handedOffBy] of [
        ["delegating-session", undefined],
        ["handed-off-session", { id: "b-chief", name: "Chief" }],
      ] as const) {
        const created = await tx.createConversation({
          ownership: { kind: "ownerless" },
        });
        state.conversations.push({
          id: created.id,
          sessionId,
          title: sessionId,
          createdAt: Date.now(),
          ...(handedOffBy ? { handedOffBy: { ...handedOffBy } } : {}),
        });
        state.turns.push({
          id: crypto.randomUUID(),
          requestKey: `web:${sessionId}`,
          fingerprint: sessionId,
          conversationId: created.id,
          source: "web",
          text: sessionId,
          createdAt: Date.now(),
          status: "done",
          answer: "Done.",
        });
      }
      (await tx.doc(Handoffs)).items.push({
        id: "h-1",
        to: { id: "b-research", name: "Research" },
        title: "Find papers",
        fromSessionId: "delegating-session",
        toSessionId: null,
        status: "working",
        createdAt: Date.now(),
        requests: [],
      } satisfies Handoff);
    }, context);
    await app.close();
    release.resolve();

    app = await Gateway.open({ directory, ...chatModel() });
    const kept = (await app.chats.state()).conversations.map(
      (c) => c.sessionId,
    );
    for (const sessionId of [
      running.sessionId,
      chat.sessionId,
      "delegating-session",
      "handed-off-session",
    ])
      assert.ok(kept.includes(sessionId), sessionId);
  } finally {
    release.resolve();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed backup keeps the sessions and the bot still starts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-one-chat-no-backup-"));
  const config = chatModel();
  let app = await Gateway.open({ directory, ...config });
  try {
    const old = await app.chats.send(web("old"));
    await withoutChat(app);
    await app.chats.send(web("chat"));
    await app.harness.waitForIdle(context);
    await app.close();
    // A file where the backups folder would go.
    await writeFile(join(directory, "backups"), "");

    app = await Gateway.open({ directory, ...config });
    assert.ok(
      (await app.chats.state()).conversations.some(
        (c) => c.sessionId === old.sessionId,
      ),
    );
    const events = (await app.harness.snapshot(Activity, context))!.events;
    assert.ok(events.some((e) => e.type === "sessions.cleanup_failed"));
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

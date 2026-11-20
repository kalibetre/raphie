import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { chatModel } from "./chat-model.ts";

async function until(check: () => Promise<boolean>) {
  for (let n = 0; n < 300; n++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("Expected state did not settle.");
}

const asking = (repeatTool = false) =>
  chatModel({
    repeatTool,
    tool: {
      name: "ask_owner",
      args: {
        question: "Dr. Amare has three openings. Which one?",
        options: [
          { label: "Tue 9:30" },
          { label: "Wed 14:00", detail: "Bole clinic" },
          { label: "Fri 11:15" },
        ],
      },
    },
  });

const answer = (url: string, id: string, body: unknown) =>
  fetch(`${url}/api/asks/${id}`, {
    method: "POST",
    headers: { "x-raphie-client": "web", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("a bot's question waits for the owner, survives a restart, and the choice goes back to the bot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-asks-"));
  let app = await Gateway.open({ directory, ...asking() });
  let http: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const turn = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: "1",
      text: "Book the dentist next week.",
    });
    await until(async () => (await app.asks.state()).asks.length === 1);
    await app.close();
    app = await Gateway.open({ directory, ...asking() });
    http = await startServer(app, { port: 0 });

    const owner = app.actors.establish("web");
    const seen = await app.queries.session(owner, turn.sessionId);
    expect(seen.phase).toBe("question");
    expect(seen.session.asking).toBe(true);
    expect(seen.asks).toHaveLength(1);
    const asked = seen.asks![0]!;
    expect(asked).toMatchObject({
      turnId: turn.id,
      question: "Dr. Amare has three openings. Which one?",
      options: [
        { label: "Tue 9:30" },
        { label: "Wed 14:00", detail: "Bole clinic" },
        { label: "Fri 11:15" },
      ],
      status: "pending",
      answer: null,
    });
    const listed = await app.queries.sessions(owner);
    expect(listed.items[0]!.asking).toBe(true);

    expect((await answer(http.url, asked.id, { choice: 3 })).status).toBe(400);
    expect((await answer(http.url, asked.id, { text: " " })).status).toBe(400);
    expect(
      await (await answer(http.url, asked.id, { choice: 1 })).json(),
    ).toEqual({ status: "answered" });
    // A second answer from another client changes nothing.
    expect(
      await (await answer(http.url, asked.id, { choice: 0 })).json(),
    ).toEqual({ status: "answered" });

    await until(
      async () =>
        (await app.chats.state()).turns.find((t) => t.id === turn.id)
          ?.status === "done",
    );
    expect(
      (await app.chats.state()).turns.find((t) => t.id === turn.id)!.answer,
    ).toBe("The owner chose: Wed 14:00");
    const after = await app.queries.session(owner, turn.sessionId);
    expect(after.asks![0]).toMatchObject({
      status: "answered",
      answer: { choice: 1 },
      answeredVia: "web",
    });
    expect(after.session.asking).toBe(false);
  } finally {
    await http?.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

test("the owner can answer in their own words, and an unanswered question expires", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-asks-text-"));
  const app = await Gateway.open({
    directory,
    askTtlMs: 400,
    ...asking(true),
  });
  try {
    const first = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: "1",
      text: "Book the dentist.",
    });
    await until(async () => (await app.asks.state()).asks.length === 1);
    const id = (await app.asks.state()).asks[0]!.id;
    expect(
      await app.asks.answer(id, { text: "Any morning works" }, "owner", "web"),
    ).toBe("answered");
    await until(
      async () =>
        (await app.chats.state()).turns.find((t) => t.id === first.id)
          ?.status === "done",
    );
    expect(
      (await app.chats.state()).turns.find((t) => t.id === first.id)!.answer,
    ).toBe("The owner answered in their own words: Any morning works");

    const second = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: "2",
      text: "And the vet?",
      conversationId: first.conversationId,
    });
    await until(
      async () =>
        (await app.chats.state()).turns.find((t) => t.id === second.id)
          ?.status === "done",
    );
    expect((await app.asks.state()).asks[1]!.status).toBe("expired");
    expect(
      (await app.chats.state()).turns.find((t) => t.id === second.id)!.answer,
    ).toMatch(/did not answer in time/);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

test("in a chat the question is posted where it was asked, and only its sender can answer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-asks-channel-"));
  const app = await Gateway.open({ directory, ...asking() });
  const thread = "discord:guild:channel:thread";
  try {
    const turn = await app.chats.send({
      source: "discord",
      actor: "owner",
      eventId: "1",
      text: "Book the dentist.",
      discordThreadId: thread,
      discordUserId: "initiator",
    });
    await until(async () => (await app.asks.state()).asks.length === 1);
    const state = await app.asks.state();
    const ask = state.asks[0]!;
    expect(ask.replyTo?.conversation).toBe(thread);
    expect(state.deliveries).toMatchObject([
      { askId: ask.id, threadId: thread, kind: "question", status: "pending" },
    ]);

    const from = (userId: string, threadId = thread) => ({
      threadId,
      connectionId: "legacy-discord",
      userId,
    });
    for (const sender of [
      from("someone-else"),
      from("initiator", "discord:guild:channel:other"),
      undefined,
    ]) {
      const refused = await app.asks
        .answer(ask.id, { choice: 0 }, "owner", "discord", undefined, sender)
        .catch((error: unknown) => error);
      expect(String(refused)).toMatch(
        /Only the person this question was asked/,
      );
    }
    expect(
      await app.asks.answer(
        ask.id,
        { choice: 2 },
        "owner",
        "discord",
        undefined,
        from("initiator"),
      ),
    ).toBe("answered");
    await until(
      async () =>
        (await app.chats.state()).turns.find((t) => t.id === turn.id)
          ?.status === "done",
    );
    expect(
      (await app.chats.state()).turns.find((t) => t.id === turn.id)!.answer,
    ).toBe("The owner chose: Fri 11:15");
    // The post is edited to show the answer and lose its buttons.
    expect(
      (await app.asks.state()).deliveries.map((d) => d.kind).sort(),
    ).toEqual(["question", "resolved"]);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

test("a scheduled turn gets no buttons: the bot is told to ask in its reply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-asks-scheduled-"));
  const app = await Gateway.open({ directory, ...asking() });
  try {
    const turn = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: "1",
      text: "Weekly check-in",
      scheduled: { name: "Check-in" },
    });
    await until(
      async () =>
        (await app.chats.state()).turns.find((t) => t.id === turn.id)
          ?.status === "done",
    );
    expect((await app.asks.state()).asks).toHaveLength(0);
    expect(
      (await app.chats.state()).turns.find((t) => t.id === turn.id)!.answer,
    ).toMatch(/Ask your question in your reply instead/);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

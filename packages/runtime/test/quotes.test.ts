import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { chatModel } from "./chat-model.ts";

const web = (eventId: string, text = eventId) => ({
  source: "web" as const,
  actor: "owner",
  eventId,
  text,
});

test("the owner quotes an earlier message; the bot reads it and the chat keeps it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-quotes-"));
  let users: string[] = [];
  const app = await Gateway.open({
    directory,
    ...chatModel({
      userMessages: (messages) => {
        users = messages.map((m) =>
          typeof m.content === "string" ? m.content : "",
        );
      },
    }),
  });
  try {
    const first = await app.chats.send(
      web("first", "Three venues   in Lisbon, please"),
    );
    await app.harness.waitForIdle(context);
    // The bot's message: the fixture model repeats what it read.
    const quoted = await app.chats.send({
      ...web("second", "Skip the second one"),
      quote: { turnId: first.id, author: "bot" },
    });
    await app.harness.waitForIdle(context);
    const turn = (await app.chats.state()).turns.find(
      (t) => t.id === quoted.id,
    )!;
    assert.deepEqual(turn.quote, {
      turnId: first.id,
      author: "bot",
      excerpt: "Three venues in Lisbon, please",
    });
    assert.match(
      users.at(-1)!,
      /The owner quotes your earlier message: "Three venues in Lisbon, please"\n\nSkip the second one$/,
    );
    // Clients see the quote with the message.
    const owner = app.actors.establish("web");
    const history = await app.queries.history(owner, first.sessionId);
    assert.equal(
      history.items.find((t) => t.id === quoted.id)?.quote?.turnId,
      first.id,
    );
    // Their own words too.
    const own = await app.chats.send({
      ...web("third", "Still true?"),
      quote: { turnId: first.id, author: "owner" },
    });
    assert.equal(
      (await app.chats.state()).turns.find((t) => t.id === own.id)?.quote
        ?.author,
      "owner",
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("only a message of the same session, with words of its author, can be quoted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-quotes-refused-"));
  const app = await Gateway.open({ directory, ...chatModel() });
  const http = await startServer(app, { port: 0 });
  try {
    const chat = await app.chats.send(web("chat"));
    const group = await app.chats.send({
      ...web("group"),
      source: "telegram",
      discordThreadId: "telegram:-100",
      connectionId: "telegram:1",
      discordUserId: "42",
    });
    const job = await app.chats.send({
      ...web("job", "Morning briefing"),
      scheduled: { name: "Briefing" },
      sessionId: chat.sessionId,
    });
    await app.harness.waitForIdle(context);
    const refused = [
      // Another session's message.
      { turnId: group.id, author: "owner" as const },
      // A scheduled job's prompt is not the owner's words.
      { turnId: job.id, author: "owner" as const },
      { turnId: "missing", author: "bot" as const },
    ];
    for (const [n, quote] of refused.entries())
      await assert.rejects(
        app.chats.send({ ...web(`refused-${n}`), quote }),
        /can't be quoted/,
      );
    // The bot's message from that run can be.
    await app.chats.send({
      ...web("job-quote"),
      quote: { turnId: job.id, author: "bot" },
    });
    // Over HTTP, a malformed quote is refused before admission.
    const response = await fetch(`${http.url}/api/sessions/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-raphie-client": "web",
      },
      body: JSON.stringify({
        eventId: "http",
        text: "Hi",
        quote: { turnId: chat.id, author: "someone" },
      }),
    });
    assert.equal(response.status, 400);
  } finally {
    await http.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

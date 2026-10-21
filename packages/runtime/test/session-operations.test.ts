import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ActorContext } from "../src/application/access/actors.ts";
import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { chatModel } from "./chat-model.ts";

test("shared operations require issued actors and preserve UUID admission and retries across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-operations-"));
  let app = await Gateway.open({ directory, ...chatModel() });
  try {
    const forged: ActorContext = { subject: "owner", source: "web" };
    await assert.rejects(
      app.sessions.submit(forged, { eventId: "denied", text: "hello" }),
      /authorized/,
    );
    for (const source of ["web", "discord"] as const) {
      const actor = app.actors.establish(
        source,
        source === "discord" ? "discord:guild:channel:thread" : undefined,
      );
      const input = { eventId: "first", text: "Remember Thursday" };
      const receipt = await app.sessions.submit(actor, input);
      assert.deepEqual(Object.keys(receipt).sort(), ["id", "sessionId"]);
      assert.equal(receipt.sessionId[14], "7");
      assert.deepEqual(await app.sessions.submit(actor, input), receipt);
      await assert.rejects(
        app.sessions.submit(actor, { ...input, text: "changed" }),
        /different content/,
      );
      await assert.rejects(
        app.sessions.submit(actor, {
          eventId: "unknown",
          text: "hello",
          sessionId: "00000000-0000-7000-8000-000000000000",
        }),
        /not found/,
      );
      const next = await app.sessions.submit(actor, {
        eventId: "second",
        text: "Which day?",
        sessionId: receipt.sessionId,
      });
      assert.equal(next.sessionId, receipt.sessionId);
      const foreign = app.actors.establish(
        "discord",
        "discord:guild:channel:other",
      );
      await assert.rejects(
        app.sessions.submit(foreign, {
          eventId: `foreign-${source}`,
          text: "Read it",
          sessionId: receipt.sessionId,
        }),
        /another Discord thread/,
      );
    }
    const original = (await app.chats.state()).turns.map((t) => t.id);
    await app.close();
    app = await Gateway.open({ directory, ...chatModel() });
    await assert.rejects(
      app.sessions.submit(forged, { eventId: "denied", text: "hello" }),
      /authorized/,
    );
    const retry = await app.sessions.submit(app.actors.establish("web"), {
      eventId: "first",
      text: "Remember Thursday",
    });
    assert.equal(retry.id, original[0]);
    assert.deepEqual(
      (await app.chats.state()).turns.map((t) => t.id),
      original,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("file experiment uses verified actors and restricts decisions to its originating connection and thread", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-copy-access-"));
  const app = await Gateway.open({ directory });
  try {
    const owner = app.actors.establish(
      "discord",
      "discord:guild:channel:one",
      "bot-one",
    );
    const input = { eventId: "file", text: "Copy once", files: [] };
    const id = await app.sessions.copy(owner, input);
    for (const denied of [
      app.actors.establish("discord", "discord:guild:channel:two", "bot-one"),
      app.actors.establish("discord", "discord:guild:channel:one", "bot-two"),
    ]) {
      await assert.rejects(
        app.sessions.copy(denied, input),
        /another Discord connection or thread/,
      );
      await assert.rejects(
        app.sessions.decideFile(denied, id, "approved"),
        /another Discord connection or thread/,
      );
    }
    await assert.rejects(
      app.sessions.copy({ subject: "owner", source: "web" }, input),
      /authorized/,
    );
    assert.equal(
      await app.sessions.decideFile(
        app.actors.establish("web"),
        id,
        "rejected",
      ),
      "rejected",
    );
    assert.equal(
      await app.sessions.decideFile(owner, id, "approved"),
      "rejected",
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

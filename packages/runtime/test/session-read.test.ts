import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { nextReadReplyCount } from "../src/domains/conversations/domain/model.ts";
import { chatModel } from "./chat-model.ts";

test("a read marker never moves back and never passes the replies", () => {
  expect(nextReadReplyCount(undefined, 1, 2)).toBe(1);
  // Another client reporting less does not undo reading.
  expect(nextReadReplyCount(2, 1, 3)).toBe(2);
  // A client cannot claim replies that do not exist.
  expect(nextReadReplyCount(0, 9, 2)).toBe(2);
});

test("read markers are shared through the session summary, and survive reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-session-read-"));
  const config = chatModel();
  let app = await Gateway.open({ directory, ...config });
  let http = await startServer(app, { port: 0 });
  const post = (path: string, data: unknown, client = true) =>
    fetch(`${http.url}/api${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(client ? { "x-raphie-client": "web" } : {}),
      },
      body: JSON.stringify(data),
    });
  const summary = async (sessionId: string) =>
    (await app.queries.session(app.actors.establish("web"), sessionId)).session;
  try {
    const owner = app.actors.establish("web");
    const first = await app.sessions.submit(owner, {
      eventId: "first",
      text: "Hello",
    });
    await app.harness.waitForIdle(context);
    await app.sessions.submit(owner, {
      eventId: "again",
      text: "Again",
      sessionId: first.sessionId,
    });
    await app.harness.waitForIdle(context);
    assert.equal((await summary(first.sessionId)).replyCount, 2);
    assert.equal((await summary(first.sessionId)).readReplyCount, 0);

    // One client reads the first reply.
    const read = await post(`/sessions/${first.sessionId}/read`, {
      replyCount: 1,
    });
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { readReplyCount: 1 });
    assert.equal((await summary(first.sessionId)).readReplyCount, 1);
    // The list every client watches carries it too.
    const listed = (
      await app.queries.sessions(app.actors.establish("web"), undefined, 100)
    ).items.find((s) => s.sessionId === first.sessionId);
    assert.equal(listed?.readReplyCount, 1);

    // Another reads both; a stale report of one changes nothing.
    await post(`/sessions/${first.sessionId}/read`, { replyCount: 2 });
    const stale = await post(`/sessions/${first.sessionId}/read`, {
      replyCount: 1,
    });
    assert.deepEqual(await stale.json(), { readReplyCount: 2 });
    // More than exists is capped.
    const beyond = await post(`/sessions/${first.sessionId}/read`, {
      replyCount: 50,
    });
    assert.deepEqual(await beyond.json(), { readReplyCount: 2 });

    // Bad input, a missing session, and a request without the client marker.
    assert.equal(
      (await post(`/sessions/${first.sessionId}/read`, { replyCount: -1 }))
        .status,
      400,
    );
    assert.equal(
      (
        await post(`/sessions/${first.sessionId}/read`, {
          replyCount: 1,
          extra: true,
        })
      ).status,
      400,
    );
    assert.equal(
      (await post(`/sessions/${crypto.randomUUID()}/read`, { replyCount: 1 }))
        .status,
      404,
    );
    assert.equal(
      (
        await post(
          `/sessions/${first.sessionId}/read`,
          { replyCount: 1 },
          false,
        )
      ).status,
      403,
    );

    // The marker is kept across a restart.
    await http.close();
    await app.close();
    app = await Gateway.open({ directory, ...config });
    http = await startServer(app, { port: 0 });
    assert.equal((await summary(first.sessionId)).readReplyCount, 2);
  } finally {
    await http.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

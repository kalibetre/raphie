import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { chatModel } from "./chat-model.ts";

test("an archived session leaves the list, is listed apart, and a new message brings it back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-session-archive-"));
  const config = chatModel();
  let app = await Gateway.open({ directory, ...config });
  let http = await startServer(app, { port: 0 });
  const api = (path: string, data?: unknown, client = true) =>
    fetch(`${http.url}/api${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(client ? { "x-raphie-client": "web" } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  const listed = async (archived = false) =>
    (
      (await (
        await api(`/sessions?limit=100${archived ? "&archived=1" : ""}`)
      ).json()) as { items: { sessionId: string; archivedAt?: number }[] }
    ).items.map((s) => s.sessionId);
  try {
    const owner = app.actors.establish("web");
    const kept = await app.sessions.submit(owner, {
      eventId: "kept",
      text: "Keep me",
    });
    // A group's session, which has a session of its own.
    const old = await app.chats.send({
      source: "telegram",
      actor: "owner",
      eventId: "old",
      text: "Put me away",
      discordThreadId: "telegram:-100",
      connectionId: "telegram:1",
      discordUserId: "42",
    });
    await app.harness.waitForIdle(context);
    assert.deepEqual(
      (await listed()).sort(),
      [kept.sessionId, old.sessionId].sort(),
    );
    assert.deepEqual(await listed(true), []);

    // Archive one: it leaves the list and shows among the archived.
    const archived = await api(`/sessions/${old.sessionId}/archive`, {
      archived: true,
    });
    assert.equal(archived.status, 200);
    assert.deepEqual(await archived.json(), { archived: true });
    assert.deepEqual(await listed(), [kept.sessionId]);
    assert.deepEqual(await listed(true), [old.sessionId]);
    // It still opens, and says it is archived.
    const opened = await app.queries.session(owner, old.sessionId);
    assert.ok(opened.session.archivedAt);
    assert.equal(opened.turns.length, 1);

    // Archived across a restart.
    await http.close();
    await app.close();
    app = await Gateway.open({ directory, ...config });
    http = await startServer(app, { port: 0 });
    assert.deepEqual(await listed(true), [old.sessionId]);

    // Unarchive puts it back.
    await api(`/sessions/${old.sessionId}/archive`, { archived: false });
    assert.deepEqual(await listed(true), []);
    assert.equal((await listed()).length, 2);

    // A new message into an archived session brings it back too.
    await api(`/sessions/${old.sessionId}/archive`, { archived: true });
    await app.sessions.submit(app.actors.establish("web"), {
      eventId: "again",
      text: "Still there?",
      sessionId: old.sessionId,
    });
    assert.deepEqual(await listed(true), []);
    assert.ok(
      !(await app.queries.session(app.actors.establish("web"), old.sessionId))
        .session.archivedAt,
    );

    // Bad input, a missing session, and a request without the client marker.
    assert.equal(
      (await api(`/sessions/${old.sessionId}/archive`, { archived: "yes" }))
        .status,
      400,
    );
    assert.equal(
      (
        await api(`/sessions/${crypto.randomUUID()}/archive`, {
          archived: true,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await api(
          `/sessions/${old.sessionId}/archive`,
          { archived: true },
          false,
        )
      ).status,
      403,
    );
  } finally {
    await app.harness.waitForIdle(context).catch(() => {});
    await http.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

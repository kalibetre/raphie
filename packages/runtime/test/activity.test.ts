import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { snapshot, startServer } from "../src/bootstrap/http-server.ts";
import {
  Activity,
  record,
  redact,
} from "../src/domains/activity/infrastructure/pi-activity-journal.ts";
import { chatModel } from "./chat-model.ts";

test("journal redacts sensitive fields while preserving reported token usage", () => {
  const result = JSON.parse(
    redact({
      authorization: "private",
      apiKey: "private",
      nested: { password: "private" },
      inputTokens: 42,
    }),
  );
  assert.equal(result.authorization, "[redacted]");
  assert.equal(result.nested.password, "[redacted]");
  assert.equal(result.inputTokens, 42);
});

test("large history snapshots stay connected and deliver later updates under backpressure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-large-events-"));
  const app = await Gateway.open({ directory });
  const http = await startServer(app, { port: 0 });
  const controller = new AbortController();
  try {
    await app.root.commit(async (tx) => {
      const journal = await tx.doc(Activity);
      for (let i = 0; i < 10; i++)
        record(journal, "fixture.large", "Large fixture", {
          details: { text: "x".repeat(20_000) },
        });
    }, context);
    const response = await fetch(`${http.url}/api/events`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]),
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let pending = "";

    async function frame() {
      while (!pending.includes("\n\n")) {
        const part = await reader.read();
        assert.equal(
          part.done,
          false,
          "stream closed before delivering the snapshot",
        );
        pending += decoder.decode(part.value, { stream: true });
      }
      const end = pending.indexOf("\n\n");
      const data = JSON.parse(pending.slice(6, end));
      pending = pending.slice(end + 2);
      return data;
    }

    assert.equal(
      (await frame()).activity.filter(
        (e: { type: string }) => e.type === "fixture.large",
      ).length,
      10,
    );
    await app.root.commit(async (tx) => {
      record(await tx.doc(Activity), "fixture.next", "Next update");
    }, context);
    assert.equal((await frame()).activity.at(-1).type, "fixture.next");
    await reader.cancel();
  } finally {
    controller.abort();
    await http.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("disconnecting a live viewer leaves work running; reconnect and reopen restore durable history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-events-"));
  let release!: () => void;
  const pause = new Promise<void>((done) => {
    release = done;
  });
  let app = await Gateway.open({ directory, ...chatModel({ pause }) });
  let http = await startServer(app, {
    port: 0,
    webOrigin: "http://127.0.0.1:3000",
  });
  const controller = new AbortController();
  try {
    const sent = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: "live",
      text: "Keep working",
    });
    const response = await fetch(`${http.url}/api/events`, {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /Message accepted/);
    controller.abort();
    assert.equal((await app.chats.state()).turns[0].status, "pending");
    release();
    for (
      let n = 0;
      n < 100 && (await app.chats.state()).turns[0].status === "pending";
      n++
    )
      await delay(10);
    assert.equal((await snapshot(app)).turns[0].answer, "Keep working");
    const events = (await snapshot(app)).activity;
    assert.ok(
      events.some((e) => e.type === "run.completed" && e.runId === sent.id),
    );
    assert.ok(events.every((e) => Number.isInteger(e.at) && e.at > 0));
    const allowed = await fetch(`${http.url}/api/chats`, {
      headers: { Origin: "http://127.0.0.1:3000" },
    });
    assert.equal(
      allowed.headers.get("access-control-allow-origin"),
      "http://127.0.0.1:3000",
    );
    assert.equal(
      (
        await fetch(`${http.url}/api/chats`, {
          headers: { Origin: "https://untrusted.example" },
        })
      ).status,
      403,
    );
    await http.close();
    await app.close();
    app = await Gateway.open({ directory, ...chatModel() });
    http = await startServer(app, { port: 0 });
    const restored = await (await fetch(`${http.url}/api/chats`)).json();
    assert.equal(restored.turns[0].id, sent.id);
    assert.ok(
      restored.activity.some((e: { id: number }) => e.id === events[0].id),
    );
    assert.equal(
      restored.activity.filter(
        (e: { type: string }) => e.type === "runtime.started",
      ).length,
      2,
    );
  } finally {
    controller.abort();
    release();
    await http.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("live projection keeps the first response block and every subsequent text delta", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-chunks-"));
  let release!: () => void;
  const streamChunkPause = new Promise<void>((done) => {
    release = done;
  });
  const app = await Gateway.open({
    directory,
    ...chatModel({ streamChunkPause }),
  });
  try {
    const sent = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: "chunks",
      text: "Stream a response",
    });
    for (
      let n = 0;
      n < 100 &&
      app.observations.live.get(sent.conversationId)?.text !== "First second";
      n++
    )
      await delay(10);
    assert.equal(
      app.observations.live.get(sent.conversationId)?.text,
      "First second",
    );
    release();
    for (
      let n = 0;
      n < 100 && (await app.chats.state()).turns[0].status === "pending";
      n++
    )
      await delay(10);
    assert.equal(
      (await app.chats.state()).turns[0].answer,
      "First second third",
    );
  } finally {
    release();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

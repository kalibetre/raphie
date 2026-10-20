import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { chatModel } from "./chat-model.ts";

test("HTTP upload, restart, duplicate decisions and binary download", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-http-"));
  let app = await Gateway.open({ directory, ...chatModel() });
  let http = await startServer(app, { port: 0 });
  const bytes = new Uint8Array([0, 255, 128, 10]);
  const headers = { "x-raphie-client": "web" };
  try {
    assert.equal((await fetch(http.url)).status, 200);
    const message = { text: "Remember Thursday", eventId: "chat-event" };
    const chatResponse = await fetch(`${http.url}/api/chat`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(message),
    });
    assert.equal(chatResponse.status, 201);
    const sent = await chatResponse.json();
    const upload = () => {
      const form = new FormData();
      form.set("text", "Keep these notes");
      form.set("eventId", "stable-event");
      form.append("files", new Blob([bytes]), "../../notes.bin");
      return fetch(`${http.url}/api/messages`, {
        method: "POST",
        headers,
        body: form,
      });
    };
    const response = await upload();
    assert.equal(response.status, 201);
    const { id } = await response.json();
    assert.equal((await (await upload()).json()).id, id);
    assert.equal(
      (
        await fetch(`${http.url}/api/approvals/${id}`, {
          method: "POST",
          body: "{}",
        })
      ).status,
      403,
    );
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      get(
        `${http.url}/api/state`,
        { headers: { Host: "evil.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      ).on("error", reject);
    });
    assert.equal(badHost, 403);
    await http.close();
    await app.close();
    app = await Gateway.open({ directory, ...chatModel() });
    http = await startServer(app, { port: 0 });
    const replay = await fetch(`${http.url}/api/chat`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(message),
    });
    assert.deepEqual(await replay.json(), sent);
    const chats = await (await fetch(`${http.url}/api/chats`)).json();
    assert.equal(chats.conversations[0].id, sent.conversationId);
    assert.equal(chats.turns.length, 1);
    const decide = () =>
      fetch(`${http.url}/api/approvals/${id}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      });
    assert.deepEqual(
      await Promise.all([decide(), decide()]).then((rs) =>
        Promise.all(rs.map((r) => r.json())),
      ),
      [{ status: "approved" }, { status: "approved" }],
    );
    for (
      let n = 0;
      n < 150 && !(await app.state()).approvals[0].completedAt;
      n++
    )
      await delay(20);
    const approval = (await app.state()).approvals[0];
    assert.equal(approval.effectCount, 1);
    const downloaded = await fetch(
      `${http.url}/api/files/${approval.results[0].id}`,
    );
    assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), bytes);
    assert.match(
      downloaded.headers.get("content-disposition")!,
      /approved-notes.bin/,
    );
    assert.equal(
      (await fetch(`${http.url}/api/files/${"0".repeat(64)}`)).status,
      404,
    );
  } finally {
    await http.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Hono rejects malformed and oversized bodies and restricts browser origins", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-hono-"));
  const runtime = await Gateway.open({ directory, ...chatModel() });
  const server = await startServer(runtime, {
    port: 0,
    webOrigin: "http://127.0.0.1:4320",
  });
  const headers = {
    "x-raphie-client": "web",
    "content-type": "application/json",
  };
  try {
    const malformed = await fetch(`${server.url}/api/chat`, {
      method: "POST",
      headers,
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.equal(typeof (await malformed.json()).error, "string");
    const oversized = await fetch(`${server.url}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "x".repeat(21000), eventId: "oversized" }),
    });
    assert.equal(oversized.status, 413);
    const invalid = await fetch(`${server.url}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "", eventId: "invalid" }),
    });
    assert.equal(invalid.status, 400);
    const forbidden = await fetch(`${server.url}/api/chats`, {
      headers: { origin: "https://evil.example" },
    });
    assert.equal(forbidden.status, 403);
    const preflight = await fetch(`${server.url}/api/chat`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:4320",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-raphie-client",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      "http://localhost:4320",
    );
    const missing = await fetch(`${server.url}/api/missing`);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "no-store");
    assert.match(
      missing.headers.get("content-security-policy") ?? "",
      /frame-ancestors 'none'/,
    );
    assert.deepEqual((await runtime.chats.state()).turns, []);
  } finally {
    await server.close();
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Hono forwards bounded Discord webhook bodies to the signature-verifying adapter", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-webhook-"));
  const runtime = await Gateway.open({ directory, ...chatModel() });
  let received = "";
  const server = await startServer(runtime, {
    port: 0,
    webhook: async (request) => {
      received = await request.text();
      return new Response(received, { status: 202 });
    },
  });
  try {
    const response = await fetch(`${server.url}/webhooks/discord`, {
      method: "POST",
      body: "signed-payload",
    });
    assert.equal(response.status, 202);
    assert.equal(await response.text(), "signed-payload");
    assert.equal(received, "signed-payload");
    const oversized = await fetch(`${server.url}/webhooks/discord`, {
      method: "POST",
      body: "x".repeat(1024 * 1024 + 1),
    });
    assert.equal(oversized.status, 413);
    assert.equal(received, "signed-payload");
  } finally {
    await server.close();
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

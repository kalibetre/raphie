import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type {
  Page,
  SessionObservation,
  SessionSummary,
  SessionTurn,
} from "@raphie/contracts";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { Chats } from "../src/domains/conversations/infrastructure/pi-conversation-service.ts";
import { chatModel } from "./chat-model.ts";

async function observation(url: string) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const result = await reader.read();
  await reader.cancel();
  const line = new TextDecoder()
    .decode(result.value)
    .split("\n")
    .find((s) => s.startsWith("data: "));
  assert.ok(line);
  return JSON.parse(line.slice(6)) as SessionObservation;
}

test("headless HTTP client submits, pages, observes, disconnects, approves and reconnects without web", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-client-"));
  const calls: unknown[] = [];
  const app = await Gateway.open({
    directory,
    ...chatModel({
      tool: { name: "mcp_fixture_execute", args: { code: "exact()" } },
    }),
    mcp: {
      identity: "fixture",
      client: {
        server: { name: "fixture", version: "1" },
        tools: [
          {
            name: "execute",
            inputSchema: {
              type: "object",
              properties: { code: { type: "string" } },
              required: ["code"],
            },
          },
        ],
        call: async (name, args) => {
          calls.push([name, args]);
          return { content: [{ type: "text", text: "Confirmed" }] };
        },
        close: async () => {},
      },
    },
  });
  const http = await startServer(app, { port: 0 });
  const post = (path: string, body: unknown) =>
    fetch(`${http.url}${path}`, {
      method: "POST",
      headers: { "x-raphie-client": "web", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const input = {
      eventId: "headless",
      text: "Use the tool",
      actor: "stranger",
    };
    const response = await post("/api/sessions/messages", input);
    assert.equal(response.status, 201);
    const receipt = (await response.json()) as {
      id: string;
      sessionId: string;
    };
    assert.equal("conversationId" in receipt, false);
    for (
      let n = 0;
      n < 100 && !(await app.toolApprovals.state()).approvals.length;
      n++
    )
      await delay(10);
    const state = await observation(
      `${http.url}/api/sessions/${receipt.sessionId}/events`,
    );
    assert.equal(state.phase, "approval");
    assert.equal(state.toolApprovals.length, 1);
    assert.equal(calls.length, 0);
    assert.equal("fingerprint" in state.turns[0], false);
    assert.equal(state.turns[0].conversationId, receipt.sessionId);
    assert.equal("replyTo" in state.toolApprovals[0], false);
    assert.equal(
      (
        await fetch(
          `${http.url}/api/sessions/${receipt.sessionId}/history?limit=101`,
        )
      ).status,
      400,
    );
    // Seed historical completed turns to prove the new bounded interface preserves access.
    await app.root.commit(async (tx) => {
      const chats = await tx.doc(Chats);
      const turn = chats.turns[0]!;
      chats.turns.unshift(
        ...Array.from({ length: 60 }, (_, n) => ({
          ...turn,
          id: `past-${n}`,
          requestKey: `past-${n}`,
          createdAt: n,
          status: "done" as const,
          answer: `answer-${n}`,
        })),
      );
    }, context);
    const history = (await (
      await fetch(`${http.url}/api/sessions/${receipt.sessionId}/history`)
    ).json()) as Page<SessionTurn>;
    assert.equal(history.items.length, 50);
    assert.ok(history.next);
    const earlier = (await (
      await fetch(
        `${http.url}/api/sessions/${receipt.sessionId}/history?before=${history.next}`,
      )
    ).json()) as Page<SessionTurn>;
    assert.equal(earlier.items.length, 11);
    assert.equal(earlier.next, null);
    const listed = (await (
      await fetch(`${http.url}/api/sessions`)
    ).json()) as Page<SessionSummary>;
    assert.equal(listed.items[0].id, receipt.sessionId);
    assert.equal(listed.items[0].turnCount, 61);
    assert.equal(listed.items[0].replyCount, 60);
    assert.equal(listed.items[0].replyPreview, "answer-59");
    const observed = (await (
      await fetch(`${http.url}/api/sessions/${receipt.sessionId}`)
    ).json()) as SessionObservation;
    assert.equal(observed.session.replyCount, listed.items[0].replyCount);
    assert.equal("discordThreadId" in listed.items[0], false);
    const proposal = state.toolApprovals[0];
    const decisions = await Promise.all([
      post(`/api/tool-approvals/${proposal.id}`, { decision: "approved" }),
      post(`/api/tool-approvals/${proposal.id}`, { decision: "rejected" }),
    ]);
    assert.deepEqual(await decisions[0].json(), { status: "approved" });
    assert.deepEqual(await decisions[1].json(), { status: "approved" });
    for (
      let n = 0;
      n < 100 && (await app.chats.state()).turns.at(-1)?.status === "pending";
      n++
    )
      await delay(10);
    const reconnected = await observation(
      `${http.url}/api/sessions/${receipt.sessionId}/events`,
    );
    assert.equal(reconnected.phase, "idle");
    assert.deepEqual(calls, [["execute", { code: "exact()" }]]);
    const retry = await post("/api/sessions/messages", input);
    assert.deepEqual(await retry.json(), receipt);
    assert.equal(calls.length, 1);
  } finally {
    await http.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("session queries authorize reads and cannot cross Discord connections or threads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-query-access-"));
  const app = await Gateway.open({ directory, ...chatModel() });
  try {
    const actor = app.actors.establish(
      "discord",
      "discord:guild:channel:one",
      "bot-one",
    );
    const receipt = await app.sessions.submit(actor, {
      eventId: "one",
      text: "Private",
    });
    assert.equal(
      (await app.queries.session(actor, receipt.sessionId)).session.id,
      receipt.sessionId,
    );
    for (const denied of [
      app.actors.establish("discord", "discord:guild:channel:two", "bot-one"),
      app.actors.establish("discord", "discord:guild:channel:one", "bot-two"),
    ]) {
      assert.deepEqual((await app.queries.sessions(denied)).items, []);
      await assert.rejects(
        app.queries.session(denied, receipt.sessionId),
        /not found/,
      );
      await assert.rejects(
        app.queries.history(denied, receipt.sessionId),
        /not found/,
      );
      await assert.rejects(
        app.queries.approvals(denied, receipt.sessionId),
        /not found/,
      );
    }
    await assert.rejects(
      app.queries.sessions({
        botId: "default",
        subject: "owner",
        source: "web",
      }),
      /authorized/,
    );
    await assert.rejects(app.queries.activity(actor), /client interface/);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

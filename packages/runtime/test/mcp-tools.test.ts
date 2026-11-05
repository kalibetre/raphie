import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { AdapterPostableMessage } from "chat";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { createDiscordBridge } from "../src/infrastructure/discord/bridge.ts";
import type { McpClient } from "../src/infrastructure/mcp/client.ts";
import { chatModel } from "./chat-model.ts";

async function until(check: () => Promise<boolean>) {
  for (let n = 0; n < 200; n++) {
    if (await check()) return;
    await delay(10);
  }
  assert.fail("Expected MCP state did not settle.");
}

function fixture(call: McpClient["call"]) {
  const client: McpClient = {
    server: { name: "fixture", version: "1" },
    tools: [
      {
        name: "execute",
        description: "Run a fixture operation",
        annotations: { readOnlyHint: true },
        inputSchema: {
          type: "object",
          properties: { code: { type: "string" } },
          required: ["code"],
        },
      },
    ],
    call,
    close: async () => {},
  };
  return { client, identity: "fixture-account" };
}

const model = (repeatTool = false) =>
  chatModel({
    repeatTool,
    tool: {
      name: "mcp_fixture_execute",
      args: { code: "perform_exactly_this()" },
    },
  });
const input = {
  source: "discord" as const,
  actor: "owner",
  eventId: "tool",
  text: "Use the tool",
  discordThreadId: "discord:guild:channel:thread",
  discordUserId: "initiator",
};

test("model tool proposal survives reopen; owner decision executes exact arguments once and returns result to model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-mcp-gate-"));
  const calls: unknown[] = [];
  const mcp = fixture(async (name, args) => {
    calls.push([name, args]);
    return { content: [{ type: "text", text: "External result confirmed" }] };
  });
  let app = await Gateway.open({ directory, ...model(), mcp });
  let http: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const turn = await app.chats.send(input);
    await until(
      async () => (await app.toolApprovals.state()).approvals.length === 1,
    );
    const proposal = (await app.toolApprovals.state()).approvals[0];
    assert.equal(calls.length, 0);
    assert.deepEqual(JSON.parse(proposal.argumentsJson), {
      code: "perform_exactly_this()",
    });
    await app.close();
    app = await Gateway.open({ directory, ...model(), mcp });
    http = await startServer(app, { port: 0 });
    const visible = await (await fetch(`${http.url}/api/chats`)).json();
    assert.equal(visible.mcp.connected, true);
    assert.equal(
      visible.toolApprovals[0].argumentsJson,
      proposal.argumentsJson,
    );
    assert.equal("fingerprint" in visible.toolApprovals[0], false);
    assert.equal("result" in visible.toolApprovals[0], false);
    const attachment = await (
      await fetch(`${http.url}/api/tool-approvals/${proposal.id}.json`)
    ).json();
    assert.deepEqual(attachment.arguments, { code: "perform_exactly_this()" });
    assert.equal(
      (
        await fetch(`${http.url}/api/tool-approvals/${proposal.id}`, {
          method: "POST",
          body: "{}",
        })
      ).status,
      403,
    );
    await assert.rejects(
      app.toolApprovals.decide(proposal.id, "approved", "stranger", "web"),
      /authorized/,
    );
    await assert.rejects(
      app.toolApprovals.decide(
        proposal.id,
        "approved",
        "owner",
        "discord",
        "discord:guild:channel:wrong",
      ),
      /another Discord thread/,
    );
    const statuses = await Promise.all([
      app.toolApprovals.decide(proposal.id, "approved", "owner", "web"),
      app.toolApprovals.decide(
        proposal.id,
        "rejected",
        "owner",
        "discord",
        input.discordThreadId,
        "legacy-discord",
        "initiator",
      ),
    ]);
    assert.deepEqual(statuses, ["approved", "approved"]);
    const duplicate = await fetch(
      `${http.url}/api/tool-approvals/${proposal.id}`,
      {
        method: "POST",
        headers: {
          "x-raphie-client": "web",
          "content-type": "application/json",
        },
        body: JSON.stringify({ decision: "approved" }),
      },
    );
    assert.deepEqual(await duplicate.json(), { status: "approved" });
    await until(
      async () =>
        (await app.chats.state()).turns.find((t) => t.id === turn.id)
          ?.status === "done",
    );
    assert.deepEqual(calls, [["execute", { code: "perform_exactly_this()" }]]);
    assert.match(
      (await app.chats.state()).turns[0].answer!,
      /External result confirmed/,
    );
    assert.equal(
      (await app.toolApprovals.state()).approvals[0].execution,
      "done",
    );
    assert.equal(
      (await app.toolApprovals.state()).deliveries.every(
        (d) => d.threadId === input.discordThreadId,
      ),
      true,
    );
    await http.close();
    http = undefined;
    await app.close();
    app = await Gateway.open({ directory, ...model(), mcp });
    assert.equal(calls.length, 1);
  } finally {
    await http?.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Discord tool approvals attach full arguments, enforce owner/thread, and disable resolved buttons", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-mcp-discord-"));
  let calls = 0;
  const code = `return ${JSON.stringify("x".repeat(2500))};`;
  const app = await Gateway.open({
    directory,
    ...chatModel({ tool: { name: "mcp_fixture_execute", args: { code } } }),
    mcp: fixture(async () => {
      calls++;
      return { content: [{ type: "text", text: "Approved result" }] };
    }),
  });
  const bridge = createDiscordBridge(app, {
    ownerId: "owner-id",
    threadId: "discord:guild:channel",
    applicationId: "fixture",
    botToken: "fixture-token",
    publicKey: "0".repeat(64),
  });
  const sent: { threadId: string; message: AdapterPostableMessage }[] = [];
  const edits: AdapterPostableMessage[] = [];
  bridge.adapter.postMessage = async (threadId, message) => {
    sent.push({ threadId, message });
    return { id: `sent-${sent.length}`, threadId, raw: {} };
  };
  bridge.adapter.editMessage = async (threadId, id, message) => {
    edits.push(message);
    return { id, threadId, raw: {} };
  };
  try {
    await bridge.chat.initialize();
    await bridge.chat.processMessage(
      bridge.adapter,
      input.discordThreadId,
      bridge.adapter.parseMessage({
        id: input.eventId,
        guild_id: "guild",
        channel_id: "thread",
        content: input.text,
        author: { id: "owner-id", username: "owner", bot: false },
        timestamp: new Date().toISOString(),
        attachments: [],
      }),
    );
    const turn = (await app.chats.state()).turns[0];
    assert.ok(turn, "Discord ingress must admit a turn without a web process");
    await until(
      async () => (await app.toolApprovals.state()).approvals.length === 1,
    );
    const approval = (await app.toolApprovals.state()).approvals[0];
    await bridge.flush();
    const card = sent[0].message;
    assert.ok(typeof card === "object" && "files" in card);
    const data = card.files![0].data;
    assert.ok(Buffer.isBuffer(data));
    assert.equal(JSON.parse(data.toString()).arguments.code, code);
    const action = (userId: string, threadId = input.discordThreadId) =>
      bridge.chat.processAction(
        {
          adapter: bridge.adapter,
          actionId: "raphie-tool-approve",
          value: approval.id,
          messageId: "sent-1",
          threadId,
          raw: {},
          user: {
            userId,
            userName: userId,
            fullName: userId,
            isBot: false,
            isMe: false,
          },
        },
        undefined,
      );
    await action("stranger");
    await assert.rejects(
      action("owner-id", "discord:guild:channel:other"),
      /another Discord thread/,
    );
    assert.equal(
      (await app.toolApprovals.state()).approvals[0].status,
      "pending",
    );
    assert.equal(calls, 0);
    await app.sessions.decide(
      app.actors.establish("web"),
      approval.id,
      "approved",
    );
    // A stale Discord button cannot repeat an action settled by another client.
    await action("owner-id");
    await until(
      async () =>
        (await app.chats.state()).turns.find((t) => t.id === turn.id)
          ?.status === "done",
    );
    await bridge.flush();
    assert.equal(calls, 1);
    assert.equal(edits.length, 1);
    const edit = edits[0];
    assert.ok(typeof edit === "object" && "children" in edit);
    const actions = edit.children.find((c) => c.type === "actions");
    assert.ok(actions?.type === "actions");
    assert.equal(
      actions.children.every((c) => c.type === "button" && c.disabled),
      true,
    );
    assert.equal(
      sent.every((m) => m.threadId === input.discordThreadId),
      true,
    );
    await action("owner-id");
    assert.equal(calls, 1);
  } finally {
    await bridge.chat.shutdown();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("explicit documentation allowlist runs directly; arbitrary read-only hints do not bypass approval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-mcp-docs-"));
  let calls = 0;
  const mcp = fixture(async () => {
    calls++;
    return { content: [{ type: "text", text: "Documentation" }] };
  });
  mcp.client.tools[0].name = "docs";
  const app = await Gateway.open({
    directory,
    ...chatModel({
      tool: { name: "mcp_fixture_docs", args: { code: "guide" } },
    }),
    mcp: { ...mcp, documentationTools: ["docs"] },
  });
  try {
    const turn = await app.chats.send(input);
    await until(
      async () =>
        (await app.chats.state()).turns.find((t) => t.id === turn.id)
          ?.status === "done",
    );
    assert.equal(calls, 1);
    assert.equal((await app.toolApprovals.state()).approvals.length, 0);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const decision of ["rejected", "expired"] as const)
  test(`MCP ${decision} proposal never calls the remote tool`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "raphie-mcp-deny-"));
    let calls = 0;
    const app = await Gateway.open({
      directory,
      ...model(),
      approvalTtlMs: decision === "expired" ? 60 : 600_000,
      mcp: fixture(async () => {
        calls++;
        return { content: [] };
      }),
    });
    try {
      const turn = await app.chats.send(input);
      await until(
        async () => (await app.toolApprovals.state()).approvals.length === 1,
      );
      const proposal = (await app.toolApprovals.state()).approvals[0];
      if (decision === "rejected")
        await app.toolApprovals.decide(proposal.id, "rejected", "owner", "web");
      await until(
        async () =>
          (await app.chats.state()).turns.find((t) => t.id === turn.id)
            ?.status === "done",
      );
      assert.equal(
        (await app.toolApprovals.state()).approvals[0].status,
        decision,
      );
      assert.equal(calls, 0);
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

test("restart after remote execution claim reports uncertainty without repeating the action", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-mcp-uncertain-"));
  let calls = 0;
  const mcp = fixture(async (_name, _args, signal) => {
    calls++;
    await new Promise<void>((_resolve, reject) =>
      signal?.addEventListener("abort", () => reject(new Error("Lost reply")), {
        once: true,
      }),
    );
    return { content: [] };
  });
  let app = await Gateway.open({ directory, ...model(), mcp });
  try {
    const turn = await app.chats.send(input);
    await until(
      async () => (await app.toolApprovals.state()).approvals.length === 1,
    );
    const proposal = (await app.toolApprovals.state()).approvals[0];
    await app.toolApprovals.decide(proposal.id, "approved", "owner", "web");
    await until(async () => calls === 1);
    await app.close();
    app = await Gateway.open({ directory, ...model(), mcp });
    await until(
      async () =>
        (await app.chats.state()).turns.find((t) => t.id === turn.id)
          ?.status === "done",
    );
    assert.equal(calls, 1);
    assert.equal(
      (await app.toolApprovals.state()).approvals[0].execution,
      "uncertain",
    );
    assert.match(
      (await app.chats.state()).turns[0].answer!,
      /outcome is unknown/,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("session MCP grant dispatches changed arguments, isolates scope, and persists revocation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-session-dispatch-"));
  const calls: unknown[] = [];
  let sequence = 0;
  const mcp = fixture(async (name, args) => {
    calls.push([name, args]);
    return { content: [{ type: "text", text: "executed" }] };
  });
  mcp.client.tools.push({ ...mcp.client.tools[0], name: "other" });
  const selection = { name: "mcp_fixture_execute", args: { code: "initial" } };
  const open = () =>
    Gateway.open({
      directory,
      ...chatModel({ tool: selection, repeatTool: true }),
      mcp,
    });
  let app = await open();
  const send = (sessionId?: string) =>
    app.chats.send({
      source: "web",
      actor: "owner",
      eventId: `scope-${++sequence}`,
      text: "Execute",
      sessionId,
    });
  const pending = async () => {
    await until(async () =>
      (await app.toolApprovals.state()).approvals.some(
        (a) => a.status === "pending",
      ),
    );
    return (await app.toolApprovals.state()).approvals.find(
      (a) => a.status === "pending",
    )!;
  };
  const done = (id: string) =>
    until(
      async () =>
        (await app.chats.state()).turns.find((t) => t.id === id)?.status ===
        "done",
    );
  try {
    const first = await send();
    const approval = await pending();
    assert.equal(calls.length, 0);
    await app.toolApprovals.decide(
      approval.id,
      "approved",
      "owner",
      "web",
      undefined,
      undefined,
      undefined,
      "session",
    );
    await done(first.id);
    assert.deepEqual(calls, [["execute", { code: "initial" }]]);
    await app.close();
    selection.args.code = "different";
    app = await open();
    const next = await send(first.sessionId);
    await done(next.id);
    assert.deepEqual(calls[1], ["execute", { code: "different" }]);
    assert.equal(
      (await app.toolApprovals.state()).approvals.filter(
        (a) => a.status === "pending",
      ).length,
      0,
    );
    const reject = async (turn: Awaited<ReturnType<typeof send>>) => {
      const proposal = await pending();
      assert.equal(calls.length, 2);
      await app.toolApprovals.decide(proposal.id, "rejected", "owner", "web");
      await done(turn.id);
    };
    await reject(await send());
    selection.name = "mcp_fixture_other";
    await app.close();
    app = await open();
    await reject(await send(first.sessionId));
    selection.name = "mcp_fixture_execute";
    mcp.identity = "another-account";
    await app.close();
    app = await open();
    await reject(await send(first.sessionId));
    mcp.identity = "fixture-account";
    await app.close();
    app = await open();
    const grants = await app.toolApprovals.listGrants("owner", first.sessionId);
    assert.equal(grants.length, 1);
    await app.toolApprovals.revokeGrant("owner", first.sessionId, grants[0].id);
    await reject(await send(first.sessionId));
    await app.close();
    app = await open();
    assert.deepEqual(
      await app.toolApprovals.listGrants("owner", first.sessionId),
      [],
    );
    await reject(await send(first.sessionId));
    assert.equal(calls.length, 2);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

// Pause after the durable authorization match, before the execution claim.
for (const action of ["stop", "revoke", "mode"] as const) {
  test(`${action} committed between authorization match and claim respects the grant`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-claim-race-"));
    let calls = 0;
    const app = await Gateway.open({
      directory,
      ...model(true),
      mcp: fixture(async () => {
        calls++;
        return { content: [] };
      }),
    });
    const matched = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const original = app.toolApprovals.ensure.bind(app.toolApprovals);
    try {
      const first = await app.chats.send(input);
      await until(
        async () => (await app.toolApprovals.state()).approvals.length === 1,
      );
      const proposal = (await app.toolApprovals.state()).approvals[0];
      await app.toolApprovals.decide(
        proposal.id,
        "approved",
        "owner",
        "web",
        undefined,
        undefined,
        undefined,
        "session",
      );
      await until(
        async () =>
          (await app.chats.state()).turns.find((t) => t.id === first.id)
            ?.status === "done",
      );
      app.toolApprovals.ensure = async (...args) => {
        const result = await original(...args);
        matched.resolve();
        await Promise.race([
          release.promise,
          new Promise<void>((resolve) => {
            const signal = args[1].abortSignal;
            if (signal?.aborted) resolve();
            else
              signal?.addEventListener("abort", () => resolve(), {
                once: true,
              });
          }),
        ]);
        return result;
      };
      if (action === "mode")
        await app.toolApprovals.approvalMode(
          "owner",
          first.sessionId,
          "full-access",
        );
      const raced = await app.chats.send({
        source: "web",
        actor: "owner",
        eventId: "race",
        text: "again",
        sessionId: first.sessionId,
      });
      await matched.promise;
      if (action === "stop") {
        await app.sessions.control(
          app.actors.establish("web"),
          first.sessionId,
          "stop",
        );
      } else if (action === "revoke") {
        const [grant] = await app.toolApprovals.listGrants(
          "owner",
          first.sessionId,
        );
        await app.toolApprovals.revokeGrant("owner", first.sessionId, grant.id);
      } else {
        await app.toolApprovals.approvalMode("owner", first.sessionId, "ask");
      }
      release.resolve();
      if (action !== "stop")
        await until(
          async () =>
            (await app.chats.state()).turns.find((t) => t.id === raced.id)
              ?.status === "done",
        );
      await app.close();
      assert.equal(calls, action === "mode" ? 2 : 1);
    } finally {
      release.resolve();
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

for (const dispatched of [false, true]) {
  test(`Stop preserves authorization boundary with ${dispatched ? "dispatched" : "pending"} MCP request`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-stop-boundary-"));
    let calls = 0;
    const entered = Promise.withResolvers<void>();
    const app = await Gateway.open({
      directory,
      ...model(),
      mcp: fixture(async (_name, _args, signal) => {
        calls++;
        entered.resolve();
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          else
            signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new Error("interrupted after dispatch");
      }),
    });
    try {
      const turn = await app.chats.send(input);
      await until(
        async () => (await app.toolApprovals.state()).approvals.length === 1,
      );
      const proposal = (await app.toolApprovals.state()).approvals[0];
      if (dispatched) {
        await app.toolApprovals.decide(proposal.id, "approved", "owner", "web");
        await entered.promise;
      }
      await app.sessions.control(
        app.actors.establish("web"),
        turn.sessionId,
        "stop",
      );
      if (!dispatched) {
        await app.toolApprovals
          .decide(
            proposal.id,
            "approved",
            "owner",
            "web",
            undefined,
            undefined,
            undefined,
            "session",
          )
          .catch(() => {});
        assert.deepEqual(
          await app.toolApprovals.listGrants("owner", turn.sessionId),
          [],
        );
      }
      await app.close();
      const reopened = await Gateway.open({
        directory,
        ...model(),
        mcp: fixture(async () => {
          calls++;
          return { content: [] };
        }),
      });
      try {
        const item = (await reopened.toolApprovals.state()).approvals.find(
          (a) => a.id === proposal.id,
        )!;
        if (dispatched)
          assert.ok(["running", "uncertain", "done"].includes(item.execution));
        else assert.notEqual(item.status, "approved");
        assert.equal(calls, dispatched ? 1 : 0);
      } finally {
        await reopened.close();
      }
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

for (const mismatch of ["none", "config", "args"] as const)
  test(`legacy pending approval recovery: ${mismatch}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "raphie-mcp-legacy-"));
    let calls = 0;
    const legacyIdentity = new Bun.CryptoHasher("sha256")
      .update(JSON.stringify({ url: "original" }))
      .digest("hex");
    const mcp = fixture(async () => {
      calls++;
      return { content: [{ type: "text", text: "done" }] };
    });
    let app = await Gateway.open({
      directory,
      ...model(),
      mcp: { ...mcp, identity: legacyIdentity },
    });
    try {
      await app.chats.send(input);
      await until(
        async () => (await app.toolApprovals.state()).approvals.length === 1,
      );
      const { ToolApprovals } =
        await import("../src/domains/approvals/infrastructure/pi-tool-approvals.ts");
      const { BACKGROUND_CONTEXT } =
        await import("@earendil-works/chord/context");
      await app.root.commit(async (tx) => {
        const item = (await tx.doc(ToolApprovals)).approvals[0];
        delete item.connectionIdentity;
        if (mismatch === "args") item.argumentsJson = "{}";
      }, BACKGROUND_CONTEXT);
      await app.close();
      app = await Gateway.open({
        directory,
        ...model(),
        mcp: {
          ...mcp,
          identity: "new-connection-and-catalog-identity",
          legacyIdentity:
            mismatch === "config" ? "changed-config-hash" : legacyIdentity,
        },
      });
      const item = (await app.toolApprovals.state()).approvals[0];
      await app.toolApprovals.decide(item.id, "approved", "owner", "web");
      if (mismatch === "none") {
        await until(
          async () =>
            (await app.toolApprovals.state()).approvals[0].execution === "done",
        );
        assert.equal(calls, 1);
        await app.close();
        app = await Gateway.open({
          directory,
          ...model(),
          mcp: {
            ...mcp,
            identity: "new-connection-and-catalog-identity",
            legacyIdentity,
          },
        });
        assert.equal(calls, 1);
      } else {
        await delay(150);
        assert.equal(calls, 0);
      }
      assert.equal((await app.toolApprovals.state()).grants?.length ?? 0, 0);
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

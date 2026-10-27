import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { State } from "../src/domains/approvals/infrastructure/pi-file-approvals.ts";
import { ToolApprovals } from "../src/domains/approvals/infrastructure/pi-tool-approvals.ts";
import type { McpClient } from "../src/infrastructure/mcp/client.ts";
import { chatModel } from "./chat-model.ts";

const thread = "discord:guild:channel:thread";
const actor = (app: Gateway, user: string) =>
  app.actors.establish("discord", thread, "application", user);

async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("Approval did not appear.");
}

const fixture = () => {
  const client: McpClient = {
    server: { name: "fixture", version: "1" },
    tools: [
      {
        name: "execute",
        description: "Execute",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    call: async () => ({ content: [{ type: "text", text: "done" }] }),
    close: async () => {},
  };
  return { client, identity: "fixture" };
};
const model = () =>
  chatModel({ tool: { name: "mcp_fixture_execute", args: {} } });

test("Discord tool decisions belong to the initiating user after restart; web owner can override", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-tool-initiator-"));
  let app = await Gateway.open({ directory, ...model(), mcp: fixture() });
  try {
    const input = { eventId: "one", text: "run" };
    await app.sessions.submit(actor(app, "alice"), input);
    await until(
      async () => (await app.toolApprovals.state()).approvals.length === 1,
    );
    const id = (await app.toolApprovals.state()).approvals[0].id;
    await assert.rejects(
      app.sessions.submit(actor(app, "bob"), input),
      /another Discord user/,
    );
    await app.close();
    app = await Gateway.open({ directory, ...model(), mcp: fixture() });
    for (const decision of ["approved", "rejected"] as const) {
      await assert.rejects(
        app.sessions.decide(actor(app, "bob"), id, decision),
        /initiated/,
      );
    }
    assert.equal(
      (await app.toolApprovals.state()).approvals[0].status,
      "pending",
    );
    assert.equal(
      await app.sessions.decide(actor(app, "alice"), id, "rejected"),
      "rejected",
    );
    await app.sessions.submit(
      app.actors.establish(
        "discord",
        "discord:guild:channel:other",
        "application",
        "alice",
      ),
      {
        eventId: "two",
        text: "run again",
      },
    );
    await until(
      async () => (await app.toolApprovals.state()).approvals.length === 2,
    );
    const second = (await app.toolApprovals.state()).approvals[1].id;
    assert.equal(
      await app.sessions.decide(
        app.actors.establish("web"),
        second,
        "rejected",
      ),
      "rejected",
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("file decisions enforce initiator and legacy pending requests require the web owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-file-initiator-"));
  let app = await Gateway.open({ directory });
  try {
    const input = { eventId: "file", text: "copy", files: [] };
    const id = await app.sessions.copy(actor(app, "alice"), input);
    await assert.rejects(
      app.sessions.copy(actor(app, "bob"), input),
      /another Discord user/,
    );
    await app.close();
    app = await Gateway.open({ directory });
    await assert.rejects(
      app.sessions.decideFile(actor(app, "bob"), id, "approved"),
      /initiated/,
    );
    assert.equal(
      await app.sessions.decideFile(actor(app, "alice"), id, "rejected"),
      "rejected",
    );
    const legacy = await app.sessions.copy(actor(app, "alice"), {
      ...input,
      eventId: "legacy",
    });
    await app.root.commit(async (tx) => {
      const item = (await tx.doc(State)).approvals.find(
        (a) => a.id === legacy,
      )!;
      delete item.discordUserId;
    }, context);
    await assert.rejects(
      app.sessions.decideFile(actor(app, "alice"), legacy, "approved"),
      /web UI/,
    );
    assert.equal(
      await app.sessions.decideFile(
        app.actors.establish("web"),
        legacy,
        "rejected",
      ),
      "rejected",
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy tool approvals without a recorded user require the web owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-tool-legacy-"));
  const app = await Gateway.open({ directory, ...model(), mcp: fixture() });
  try {
    await app.sessions.submit(actor(app, "alice"), {
      eventId: "legacy",
      text: "run",
    });
    await until(
      async () => (await app.toolApprovals.state()).approvals.length === 1,
    );
    const id = (await app.toolApprovals.state()).approvals[0].id;
    await app.root.commit(async (tx) => {
      delete (await tx.doc(ToolApprovals)).approvals[0].discordUserId;
    }, context);
    await assert.rejects(
      app.sessions.decide(actor(app, "alice"), id, "approved"),
      /web UI/,
    );
    assert.equal(
      await app.sessions.decide(app.actors.establish("web"), id, "rejected"),
      "rejected",
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ambiguous queued turns cannot grant approval authority to the wrong Discord user", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-approval-queue-"));
  let release!: () => void;
  let started!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const app = await Gateway.open({
    directory,
    ...chatModel({
      tool: { name: "mcp_fixture_execute", args: {} },
      pause: paused,
      started,
    }),
    mcp: fixture(),
  });
  try {
    await app.sessions.submit(actor(app, "alice"), {
      eventId: "one",
      text: "first",
    });
    await running;
    await app.sessions.submit(actor(app, "bob"), {
      eventId: "two",
      text: "second",
    });
    release();
    await until(
      async () => (await app.toolApprovals.state()).approvals.length > 0,
    );
    const approval = (await app.toolApprovals.state()).approvals[0];
    assert.equal(approval.discordUserId, undefined);
    for (const user of ["alice", "bob"])
      await assert.rejects(
        app.sessions.decide(actor(app, user), approval.id, "approved"),
        /web UI/,
      );
    assert.equal(
      await app.sessions.decide(
        app.actors.establish("web"),
        approval.id,
        "rejected",
      ),
      "rejected",
    );
  } finally {
    release();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

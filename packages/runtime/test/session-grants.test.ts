import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { ToolApprovals } from "../src/domains/approvals/infrastructure/pi-tool-approvals.ts";
import { chatModel } from "./chat-model.ts";

test("command permissions persist independently of once-only MCP approval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "command-permissions-"));
  let app = await Gateway.open({
    directory,
    deferResume: true,
    ...chatModel(),
  });
  try {
    const turn = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: "first",
      text: "hello",
    });
    await app.toolApprovals.approvalMode(
      "owner",
      turn.sessionId,
      "full-access",
    );
    const propose = (taskId: number, connectionIdentity: string) =>
      app.toolApprovals.ensure(
        {
          conversationId: turn.conversationId,
          taskId,
          commit: app.root.commit.bind(app.root),
        } as Parameters<typeof app.toolApprovals.ensure>[0],
        BACKGROUND_CONTEXT,
        {
          fingerprint: "same",
          connectionIdentity,
          server:
            connectionIdentity === "raphie.workspace.command"
              ? "workspace"
              : "fixture",
          tool:
            connectionIdentity === "raphie.workspace.command"
              ? "bash"
              : "execute",
          argumentsJson: "{}",
        },
      );
    expect((await propose(100, "raphie.workspace.command")).status).toBe(
      "approved",
    );
    const first = await propose(101, "mcp-fixture");
    expect(first.status).toBe("pending");
    await app.toolApprovals.decide(
      first.id,
      "approved",
      "owner",
      "web",
      undefined,
      undefined,
      undefined,
      "once",
    );
    expect((await propose(102, "mcp-fixture")).status).toBe("pending");
    expect(await app.toolApprovals.approvalMode("owner", turn.sessionId)).toBe(
      "full-access",
    );
    await app.close();
    app = await Gateway.open({ directory, deferResume: true, ...chatModel() });
    expect(await app.toolApprovals.approvalMode("owner", turn.sessionId)).toBe(
      "full-access",
    );
    expect((await propose(103, "mcp-fixture")).status).toBe("pending");
    await app.toolApprovals.approvalMode("owner", turn.sessionId, "ask");
    expect((await propose(104, "raphie.workspace.command")).status).toBe(
      "pending",
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("once approvals leave preexisting requests pending and never cross bots", async () => {
  const directories = await Promise.all(
    [0, 1].map(() => mkdtemp(join(tmpdir(), "grant-bot-"))),
  );
  const apps = await Promise.all(
    directories.map((directory) =>
      Gateway.open({ directory, deferResume: true, ...chatModel() }),
    ),
  );
  try {
    const propose = async (app: (typeof apps)[number], taskId: number) => {
      const turn = await app.chats.send({
        source: "web",
        actor: "owner",
        eventId: String(taskId),
        text: "hello",
      });
      return app.toolApprovals.ensure(
        {
          conversationId: turn.conversationId,
          taskId,
          commit: app.root.commit.bind(app.root),
        } as Parameters<typeof app.toolApprovals.ensure>[0],
        BACKGROUND_CONTEXT,
        {
          fingerprint: "same",
          connectionIdentity: "same-connection",
          server: "fixture",
          tool: "execute",
          argumentsJson: "{}",
        },
      );
    };
    const first = await propose(apps[0]!, 1);
    const pending = await propose(apps[0]!, 2);
    await apps[0]!.toolApprovals.decide(
      first.id,
      "approved",
      "owner",
      "web",
      undefined,
      undefined,
      undefined,
      "once",
    );
    expect(
      (await apps[0]!.toolApprovals.state()).approvals.find(
        (a) => a.id === pending.id,
      )?.status,
    ).toBe("pending");
    expect((await propose(apps[1]!, 1)).status).toBe("pending");
  } finally {
    await Promise.all(apps.map((app) => app.close()));
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  }
});

test("legacy MCP Full access must not authorize commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "legacy-command-mode-"));
  const app = await Gateway.open({
    directory,
    deferResume: true,
    ...chatModel(),
  });
  try {
    const turn = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: "legacy",
      text: "hello",
    });
    await app.root.commit(async (tx) => {
      (await tx.doc(ToolApprovals)).modes = {
        [String(turn.conversationId)]: "full-access",
      };
    }, BACKGROUND_CONTEXT);
    expect(await app.toolApprovals.approvalMode("owner", turn.sessionId)).toBe(
      "ask",
    );
    const approval = await app.toolApprovals.ensure(
      {
        conversationId: turn.conversationId,
        taskId: 100,
        commit: app.root.commit.bind(app.root),
      } as Parameters<typeof app.toolApprovals.ensure>[0],
      BACKGROUND_CONTEXT,
      {
        fingerprint: "legacy-command",
        connectionIdentity: "raphie.workspace.command",
        server: "workspace",
        tool: "bash",
        argumentsJson: '{"command":"pwd"}',
      },
    );
    expect(approval.status).toBe("pending");
    await app.toolApprovals.approvalMode(
      "owner",
      turn.sessionId,
      "full-access",
    );
    const propose = (fingerprint: string) =>
      app.toolApprovals.ensure(
        {
          conversationId: turn.conversationId,
          taskId: fingerprint === "full-command" ? 101 : 102,
          commit: app.root.commit.bind(app.root),
        } as Parameters<typeof app.toolApprovals.ensure>[0],
        BACKGROUND_CONTEXT,
        {
          fingerprint,
          connectionIdentity: "raphie.workspace.command",
          server: "workspace",
          tool: "bash",
          argumentsJson: '{"command":"pwd"}',
        },
      );
    expect((await propose("full-command")).status).toBe("approved");
    expect(
      (await app.toolApprovals.state()).approvals.find(
        (a) => a.id === approval.id,
      )?.status,
    ).toBe("pending");
    await app.toolApprovals.approvalMode("owner", turn.sessionId, "ask");
    expect((await propose("ask-command")).status).toBe("pending");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("first message persists its command mode and later conversations default to Ask", async () => {
  const directory = await mkdtemp(join(tmpdir(), "first-command-mode-"));
  const app = await Gateway.open({ directory, deferResume: true, ...chatModel() });
  try {
    const first = await app.chats.send({ source: "web", actor: "owner", eventId: "full", text: "hello", approvalMode: "full-access" });
    expect(await app.toolApprovals.approvalMode("owner", first.sessionId)).toBe("full-access");
    const second = await app.chats.send({ source: "web", actor: "owner", eventId: "ask", text: "hello" });
    expect(await app.toolApprovals.approvalMode("owner", second.sessionId)).toBe("ask");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

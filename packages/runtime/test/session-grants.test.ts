import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { ToolApprovals } from "../src/domains/approvals/infrastructure/pi-tool-approvals.ts";
import { chatModel } from "./chat-model.ts";

test("session grants list safely, isolate sessions, persist revocation, and reject unauthorized actors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "session-grants-"));
  let app = await Gateway.open({
    directory,
    deferResume: true,
    ...chatModel(),
  });
  try {
    const first = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: "first",
      text: "hello",
    });
    const second = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: "second",
      text: "hello",
    });
    expect(await app.toolApprovals.approvalMode("owner", first.sessionId)).toBe(
      "ask",
    );
    expect(
      app.toolApprovals.approvalMode(
        "intruder",
        first.sessionId,
        "full-access",
      ),
    ).rejects.toThrow();
    expect(
      app.toolApprovals.revokeGrant("intruder", first.sessionId, "grant"),
    ).rejects.toThrow();
    expect(
      app.toolApprovals.approvalMode("owner", "missing", "full-access"),
    ).rejects.toThrow();
    expect(await app.toolApprovals.approvalMode("owner", first.sessionId)).toBe(
      "ask",
    );
    await app.toolApprovals.approvalMode(
      "owner",
      first.sessionId,
      "full-access",
    );
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(
      await app.toolApprovals.approvalMode("owner", second.sessionId),
    ).toBe("ask");
    await app.root.commit(async (tx) => {
      (await tx.doc(ToolApprovals)).grants = [
        {
          id: "grant",
          conversationId: first.conversationId,
          tool: "execute",
          connectionIdentity: "secret-identity",
          actor: "secret-actor",
          revoked: false,
        },
      ];
    }, BACKGROUND_CONTEXT);
    expect(
      await app.toolApprovals.listGrants("owner", first.sessionId),
    ).toEqual([{ id: "grant", tool: "execute" }]);
    expect(
      app.toolApprovals.listGrants("intruder", first.sessionId),
    ).rejects.toThrow();
    expect(
      app.toolApprovals.revokeGrant("owner", "missing", "grant"),
    ).rejects.toThrow();
    if (second.sessionId !== first.sessionId) {
      expect(
        await app.toolApprovals.listGrants("owner", second.sessionId),
      ).toEqual([]);
      expect(
        app.toolApprovals.revokeGrant("owner", second.sessionId, "grant"),
      ).rejects.toThrow();
    }
    await app.close();
    app = await Gateway.open({ directory, deferResume: true, ...chatModel() });
    expect(await app.toolApprovals.approvalMode("owner", first.sessionId)).toBe(
      "full-access",
    );
    await app.toolApprovals.approvalMode("owner", first.sessionId, "ask");
    expect(
      await app.toolApprovals.listGrants("owner", first.sessionId),
    ).toHaveLength(1);
    await app.toolApprovals.revokeGrant("owner", first.sessionId, "grant");
    await app.close();
    app = await Gateway.open({ directory, deferResume: true, ...chatModel() });
    expect(
      await app.toolApprovals.listGrants("owner", first.sessionId),
    ).toEqual([]);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("session grants leave preexisting requests pending and never cross bots", async () => {
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
      "session",
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

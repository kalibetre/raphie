import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { chatModel } from "./chat-model.ts";

test("dispatch requires once again, persists exact session grants and their revocation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "exact-dispatch-"));
  const open = () =>
    Gateway.open({
      directory,
      ...chatModel({
        tool: { name: "workspace_exec", args: { command: "echo granted" } },
        repeatTool: true,
      }),
    });
  let app = await open();
  let sessionId: string | undefined;
  const run = async (scope?: "once" | "session") => {
    const before = new Set(
      (await app.toolApprovals.state()).approvals.map((a) => a.id),
    );
    const receipt = await app.sessions.submit(app.actors.establish("web"), {
      sessionId,
      eventId: crypto.randomUUID(),
      text: "execute command",
    });
    sessionId = receipt.sessionId;
    let asked = false;
    for (let i = 0; i < 400; i++) {
      const pending = (await app.toolApprovals.state()).approvals.find(
        (a) => !before.has(a.id) && a.status === "pending",
      );
      if (pending) {
        expect(asked).toBe(false);
        asked = true;
        expect(scope).toBeDefined();
        await app.toolApprovals.decide(
          pending.id,
          "approved",
          "owner",
          "web",
          undefined,
          undefined,
          undefined,
          scope,
        );
      }
      const turn = (await app.chats.state()).turns.find(
        (t) => t.id === receipt.id,
      );
      if (turn && turn.status !== "pending") {
        expect(JSON.stringify(turn)).toContain("granted");
        expect(asked).toBe(scope !== undefined);
        return receipt;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("dispatch did not settle");
  };
  try {
    await run("once");
    await run("session");
    await run();
    await app.close();
    app = await open();
    const receipt = await run();
    const grants = await app.toolApprovals.listGrants(
      "owner",
      receipt.sessionId,
    );
    expect(grants).toHaveLength(1);
    await app.toolApprovals.revokeGrant(
      "owner",
      receipt.sessionId,
      grants[0]!.id,
    );
    await app.close();
    app = await open();
    await run("once");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);

test("first-turn dispatch honors Full access, explicit Ask and the safe default in isolated conversations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "first-dispatch-"));
  const app = await Gateway.open({
    directory,
    ...chatModel({
      tool: {
        name: "workspace_exec",
        args: { command: "echo first-turn-executed" },
      },
      repeatTool: true,
    }),
  });
  try {
    for (const approvalMode of ["full-access", "ask", undefined] as const) {
      const receipt = await app.sessions.submit(app.actors.establish("web"), {
        eventId: crypto.randomUUID(),
        text: "execute",
        approvalMode,
      });
      let settled = false;
      for (let attempt = 0; attempt < 400; attempt++) {
        const pending = (await app.toolApprovals.state()).approvals.find(
          (a) => a.status === "pending",
        );
        const turn = (await app.chats.state()).turns.find(
          (t) => t.id === receipt.id,
        );
        if (pending) {
          expect(approvalMode).not.toBe("full-access");
          expect(turn?.status).toBe("pending");
          await app.toolApprovals.decide(
            pending.id,
            "rejected",
            "owner",
            "web",
          );
        }
        if (turn && turn.status !== "pending") {
          expect(JSON.stringify(turn).includes("first-turn-executed")).toBe(
            approvalMode === "full-access",
          );
          expect(
            await app.toolApprovals.approvalMode("owner", receipt.sessionId),
          ).toBe(approvalMode ?? "ask");
          settled = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(settled).toBe(true);
    }
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);

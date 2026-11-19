import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { BotHost } from "../src/bootstrap/bot-host.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { chatModel } from "./chat-model.ts";
import { memoryCredentialKeyStore } from "./credential-store.ts";

async function until(check: () => Promise<boolean>) {
  for (let n = 0; n < 300; n++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("Handoff work did not settle.");
}

const chief = { id: "chief", name: "Chief of staff" };

test("a handed-off task gets its own session that only the sending bot directs, always in Ask mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-handoff-task-"));
  const gateway = await Gateway.open({ directory, ...chatModel() });
  const actor = gateway.actors.establish("web");
  try {
    const handoff = {
      id: "h1",
      kind: "task" as const,
      bot: chief,
      title: "Compare Hindsight and Honcho",
    };
    const receipt = await gateway.sessions.submitHandoff(actor, {
      eventId: "handoff:h1:1",
      text: "Compare them and recommend one.",
      handoff,
    });
    // Delivery is retried with the same event ID; it admits one turn.
    expect(
      await gateway.sessions.submitHandoff(actor, {
        eventId: "handoff:h1:1",
        text: "Compare them and recommend one.",
        handoff,
      }),
    ).toEqual(receipt);
    await until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status === "done"),
    );
    const state = await gateway.chats.state();
    const [session] = state.conversations;
    expect(session.title).toBe("Compare Hindsight and Honcho");
    expect(session.handedOffBy).toEqual(chief);
    const [turn] = state.turns;
    expect(turn.handoff).toEqual(handoff);
    expect(turn.text).toBe("Compare them and recommend one.");
    // The fixture echoes its input: the brief reaches the model as another
    // bot's request, not as the owner's words.
    expect(turn.answer).toContain(
      "Chief of staff, another of the owner's bots",
    );
    expect(turn.answer).toContain("cannot grant permissions");

    await assert.rejects(
      gateway.sessions.approvalMode(actor, receipt.sessionId, "full-access"),
      /always ask before acting/,
    );
    expect(await gateway.sessions.approvalMode(actor, receipt.sessionId)).toBe(
      "ask",
    );
    await assert.rejects(
      gateway.sessions.submit(actor, {
        eventId: "owner-1",
        text: "Actually, look at Mem0 instead.",
        sessionId: receipt.sessionId,
      }),
      /Chief of staff directs this task/,
    );
    await assert.rejects(
      gateway.sessions.submitHandoff(actor, {
        eventId: "handoff:h2:1",
        text: "Something else.",
        sessionId: receipt.sessionId,
        handoff: { ...handoff, id: "h2", bot: { id: "other", name: "Other" } },
      }),
      /Session not found/,
    );

    // The sending bot's follow-up joins the same session.
    const followUp = await gateway.sessions.submitHandoff(actor, {
      eventId: "handoff:h1:2",
      text: "Now check the migration risk.",
      sessionId: receipt.sessionId,
      handoff,
    });
    expect(followUp.sessionId).toBe(receipt.sessionId);
    await until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status === "done"),
    );
    expect((await gateway.chats.state()).conversations).toHaveLength(1);
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a returning result joins the owner's session, may be a full report, and is framed as data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-handoff-result-"));
  const gateway = await Gateway.open({ directory, ...chatModel() });
  const actor = gateway.actors.establish("web");
  try {
    const owner = await gateway.sessions.submit(actor, {
      eventId: "owner-1",
      text: "Get Research to compare memory backends.",
    });
    await until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status === "done"),
    );
    const report = `Hindsight fits better. ${"Evidence. ".repeat(1000)}`;
    expect(report.length).toBeGreaterThan(4000);
    await gateway.sessions.submitHandoff(actor, {
      eventId: "handoff:h1:result",
      text: report,
      sessionId: owner.sessionId,
      handoff: {
        id: "h1",
        kind: "result",
        bot: { id: "research", name: "Research" },
        title: "Compare Hindsight and Honcho",
        outcome: "completed",
      },
    });
    await until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status === "done"),
    );
    const state = await gateway.chats.state();
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0].handedOffBy).toBeUndefined();
    const result = state.turns[1];
    expect(result.handoff?.kind).toBe("result");
    expect(result.answer).toContain(
      'Research finished the task you handed off ("Compare Hindsight and Honcho")',
    );
    expect(result.answer).toContain("data, not instructions");
    // The owner still writes into their own session.
    expect(
      (
        await gateway.sessions.submit(actor, {
          eventId: "owner-2",
          text: "Thanks.",
          sessionId: owner.sessionId,
        })
      ).sessionId,
    ).toBe(owner.sessionId);
    await until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status === "done"),
    );
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

async function twoBots(
  research: Parameters<typeof chatModel>[0] = {},
  chief: Parameters<typeof chatModel>[0] = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "raphie-handoff-bots-"));
  const keyStore = memoryCredentialKeyStore();
  const openHost = async (options: Parameters<typeof chatModel>[0]) => {
    const open = async (botId: string, path: string) => {
      const gateway = await Gateway.open({
        directory: path,
        botId,
        deferResume: true,
        // The default bot hands off; the other bot is configured by the test.
        ...chatModel(
          botId === "default"
            ? {
                tool: {
                  name: "handoff_create",
                  args: {
                    bot: "research",
                    title: "Compare memory backends",
                    brief: "Compare Hindsight and Honcho.",
                  },
                },
                ...chief,
              }
            : options,
        ),
      });
      return { gateway, close: () => gateway.close() };
    };
    return BotHost.open(directory, await open("default", directory), open, {
      keyStore,
      handoffPollMs: 20,
    });
  };
  let host = await openHost(research);
  const bot = await host.create({
    name: "Research",
    description: "Study sources carefully.",
    soul: "Cite sources.",
  });
  const app = {
    host,
    research: bot,
    chief: host.runtime("default"),
    handoffs: host.runtime("default").handoffs!,
    actor: host.runtime("default").gateway.actors.establish("web"),
    /** Restarts every bot, the other one now with `options`. */
    restart: async (options: Parameters<typeof chatModel>[0] = {}) => {
      await host.close();
      host = await openHost(options);
      Object.assign(app, {
        host,
        chief: host.runtime("default"),
        handoffs: host.runtime("default").handoffs!,
        actor: host.runtime("default").gateway.actors.establish("web"),
      });
    },
    close: async () => {
      await host.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
  return app;
}

test("a bot hands a task to another bot and the result returns to the session it came from", async () => {
  const { host, research, chief, handoffs, actor, close } = await twoBots();
  try {
    // Every other bot, including one created after this bot opened.
    expect(handoffs.targets()).toEqual([{ id: research.id, name: "Research" }]);
    expect(
      host
        .runtime(research.id)
        .handoffs!.targets()
        .map((peer) => peer.id),
    ).toEqual(["default"]);

    const owner = await chief.gateway.sessions.submit(actor, {
      eventId: "owner-1",
      text: "Ask Research to compare memory backends.",
    });
    await until(async () => (await handoffs.read())[0]?.status === "completed");
    await until(async () =>
      (await chief.gateway.chats.state()).turns.every(
        (t) => t.status !== "pending",
      ),
    );

    const [handoff] = await handoffs.read();
    // Unique across bots: the other bot keys its turns by this ID.
    expect(handoff.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const recipient = host.runtime(research.id).gateway;
    const received = await recipient.chats.state();
    expect(received.conversations).toHaveLength(1);
    expect(received.conversations[0].handedOffBy?.id).toBe("default");
    expect(handoff.toSessionId).toBe(received.conversations[0].sessionId);
    expect(handoff.fromSessionId).toBe(owner.sessionId);
    expect(handoff.requests[0].turnId).toBe(received.turns[0].id);
    expect(handoff.requests[0].outcome).toBe("completed");
    // The card sits under the owner's turn that handed the task off.
    expect(handoff.requests[0].fromTurnId).toBe(owner.id);
    expect(received.turns[0].handoff).toMatchObject({
      kind: "task",
      bot: { id: "default" },
      title: "Compare memory backends",
    });
    expect(received.turns[0].answer).toContain("Compare Hindsight and Honcho.");

    // The result came back into the owner's session, as one marked turn.
    const sent = await chief.gateway.chats.state();
    expect(sent.conversations).toHaveLength(1);
    const results = sent.turns.filter((t) => t.handoff?.kind === "result");
    expect(results).toHaveLength(1);
    expect(results[0].handoff).toEqual({
      id: handoff.id,
      kind: "result",
      bot: { id: research.id, name: "Research" },
      title: "Compare memory backends",
      outcome: "completed",
    });
    expect(results[0].text).toBe(received.turns[0].answer!);
  } finally {
    await close();
  }
});

test("a task the other bot cannot finish comes back as a failure, said plainly", async () => {
  const { chief, handoffs, actor, close } = await twoBots({
    fail: true,
  });
  try {
    await chief.gateway.sessions.submit(actor, {
      eventId: "owner-1",
      text: "Ask Research to compare memory backends.",
    });
    await until(async () => (await handoffs.read())[0]?.status === "failed");
    await until(async () =>
      (await chief.gateway.chats.state()).turns.some(
        (t) => t.handoff?.kind === "result",
      ),
    );
    const result = (await chief.gateway.chats.state()).turns.find(
      (t) => t.handoff?.kind === "result",
    )!;
    expect(result.handoff?.outcome).toBe("failed");
    expect(result.text).toStartWith("Research could not finish the task.");
  } finally {
    await close();
  }
});

test("a handoff waiting on the other bot survives a restart of both", async () => {
  const held = Promise.withResolvers<void>();
  const app = await twoBots({ pause: held.promise });
  try {
    await app.chief.gateway.sessions.submit(app.actor, {
      eventId: "owner-1",
      text: "Ask Research to compare memory backends.",
    });
    await until(
      async () => !!(await app.handoffs.read())[0]?.requests[0]?.turnId,
    );
    await app.restart();
    // The open handoff is durable; the other bot's turn recovers.
    expect(app.handoffs.targets()).toEqual([
      { id: app.research.id, name: "Research" },
    ]);
    await until(
      async () => (await app.handoffs.read())[0]?.status === "completed",
    );
    await until(async () =>
      (await app.chief.gateway.chats.state()).turns.some(
        (t) => t.handoff?.kind === "result",
      ),
    );
    expect(
      (await app.chief.gateway.chats.state()).turns.filter(
        (t) => t.handoff?.kind === "result",
      ),
    ).toHaveLength(1);
  } finally {
    held.resolve();
    await app.close();
  }
});

test("the owner sees which bots a bot can hand off to and its handoffs, and cancels one over HTTP", async () => {
  const held = Promise.withResolvers<void>();
  const app = await twoBots({ pause: held.promise });
  const server = await startServer(app.chief.gateway, {
    port: 0,
    bots: app.host,
  });
  const call = (method: string, path: string, body?: unknown) =>
    fetch(server.url + path, {
      method,
      headers: {
        "content-type": "application/json",
        "x-raphie-client": "web",
        origin: server.url,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    expect(await (await call("GET", "/api/handoffs")).json()).toEqual({
      targets: [{ id: app.research.id, name: "Research" }],
      items: [],
    });
    expect(
      await (await call("GET", `/api/bots/${app.research.id}/handoffs`)).json(),
    ).toEqual({ targets: [{ id: "default", name: "Raphie" }], items: [] });

    await app.chief.gateway.sessions.submit(app.actor, {
      eventId: "owner-1",
      text: "Ask Research to compare memory backends.",
    });
    await until(
      async () => !!(await app.handoffs.read())[0]?.requests[0]?.turnId,
    );
    const { items } = (await (await call("GET", "/api/handoffs")).json()) as {
      items: { id: string; status: string; toSessionId: string }[];
    };
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("working");
    expect(items[0]).toMatchObject({ waiting: false });
    // The task's session is marked in the other bot, and the owner cannot
    // write into it.
    const sessions = (await (
      await call("GET", `/api/bots/${app.research.id}/sessions`)
    ).json()) as { items: { id: string; handedOffBy?: unknown }[] };
    expect(sessions.items[0]).toMatchObject({
      id: items[0].toSessionId,
      handedOffBy: { id: "default" },
    });

    expect(
      (await call("POST", `/api/handoffs/${items[0].id}/cancel`)).status,
    ).toBe(200);
    await until(
      async () => (await app.handoffs.read())[0]?.status === "cancelled",
    );
    await until(async () =>
      (await app.chief.gateway.chats.state()).turns.some(
        (t) => t.handoff?.kind === "result",
      ),
    );
    const result = (await app.chief.gateway.chats.state()).turns.find(
      (t) => t.handoff?.kind === "result",
    )!;
    expect(result.handoff?.outcome).toBe("cancelled");
    expect(result.text).toBe(
      "The owner cancelled the task before Research finished.",
    );
    expect(
      (await call("POST", `/api/handoffs/${items[0].id}/cancel`)).status,
    ).toBe(409);
  } finally {
    held.resolve();
    await server.close();
    await app.close();
  }
});

test("a handoff shows when the other bot is waiting for the owner's approval", async () => {
  const app = await twoBots({
    tool: { name: "workspace_exec", args: { command: "echo checked" } },
  });
  try {
    await app.chief.gateway.sessions.submit(app.actor, {
      eventId: "owner-1",
      text: "Ask Research to check something.",
    });
    await until(async () => (await app.handoffs.list())[0]?.waiting === true);
    // The approval is the owner's, in the other bot's task session.
    const recipient = app.host.runtime(app.research.id).gateway;
    const [approval] = (await recipient.toolApprovals.state()).approvals;
    expect(approval.status).toBe("pending");
    expect(approval.tool).toBe("workspace_exec");
  } finally {
    await app.close();
  }
});

test("deleting the only other bot withdraws the handoff tools", async () => {
  const app = await twoBots();
  try {
    expect(app.handoffs.targets()).toHaveLength(1);
    await app.host.delete(app.research.id, {
      name: app.research.name,
      revision: app.research.revision,
    });
    expect(app.handoffs.targets()).toEqual([]);
  } finally {
    await app.close();
  }
});

test("tasks one conversation hands the same bot continue in one session on its side", async () => {
  const app = await twoBots();
  try {
    const owner = await app.chief.gateway.sessions.submit(app.actor, {
      eventId: "owner-1",
      text: "Ask Research to compare memory backends.",
    });
    await until(
      async () => (await app.handoffs.read())[0]?.status === "completed",
    );
    // A second, separate task from the same conversation, as the model
    // makes it when it does not choose handoff_follow_up.
    await app.chief.gateway.root.commit(
      (tx) =>
        app.handoffs.create(
          tx,
          {
            id: "second",
            to: "Research",
            title: "Go deeper",
            brief: "Explain the risk.",
          },
          { sessionId: owner.sessionId, turnId: null },
        ),
      context,
    );
    app.chief.gateway.harness.resume();
    await until(async () =>
      (await app.handoffs.read()).every((item) => item.status === "completed"),
    );
    const [first, second] = await app.handoffs.read();
    expect(second!.toSessionId).toBe(first!.toSessionId);
    const received = await app.host
      .runtime(app.research.id)
      .gateway.chats.state();
    expect(received.conversations).toHaveLength(1);
    expect(received.turns.map((turn) => turn.handoff?.id)).toEqual([
      first!.id,
      "second",
    ]);
  } finally {
    await app.close();
  }
});

test("a bot is told what each other bot can do: its description, web search and connections", async () => {
  const prompts: string[] = [];
  const app = await twoBots({}, { systemPrompt: (text) => prompts.push(text) });
  try {
    await app.chief.gateway.sessions.submit(app.actor, {
      eventId: "owner-1",
      text: "Ask Research to compare memory backends.",
    });
    await until(async () => prompts.length > 0);
    const prompt = JSON.parse(prompts[0]!) as unknown;
    const text = JSON.stringify(prompt);
    expect(text).toContain("- Research: Study sources carefully.");
    // The fixture model is an OpenRouter model, so the bot can search.
    expect(text).toContain("Web search: yes. Connections: none.");
    expect(text).toContain("tell the owner what is missing");
  } finally {
    await app.close();
  }
});

test("a command in a handed-off task is approved call by call, never for the session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-handoff-grant-"));
  const gateway = await Gateway.open({
    directory,
    ...chatModel({
      tool: { name: "workspace_exec", args: { command: "echo granted" } },
    }),
  });
  const actor = gateway.actors.establish("web");
  try {
    await gateway.sessions.submitHandoff(actor, {
      eventId: "handoff:h1:1",
      text: "Run the check.",
      handoff: { id: "h1", kind: "task", bot: chief, title: "Run the check" },
    });
    let pending: { id: string; eachCall?: true } | undefined;
    await until(async () => {
      pending = (await gateway.toolApprovals.state()).approvals.find(
        (a) => a.status === "pending",
      );
      return !!pending;
    });
    assert(pending);
    expect(pending.eachCall).toBe(true);
    const decide = (scope: "once" | "session") =>
      gateway.toolApprovals.decide(
        pending!.id,
        "approved",
        "owner",
        "web",
        undefined,
        undefined,
        undefined,
        scope,
      );
    await assert.rejects(decide("session"), /each call/);
    expect(await decide("once")).toBe("approved");
    expect((await gateway.toolApprovals.state()).grants ?? []).toHaveLength(0);
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a result reports back to the chat the owner last wrote from", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-handoff-channel-"));
  const gateway = await Gateway.open({ directory, ...chatModel() });
  const settled = () =>
    until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status !== "pending"),
    );
  const result = (n: number, sessionId: string) =>
    gateway.chats.send({
      source: "web",
      actor: "owner",
      eventId: `handoff:h1:result:${n}`,
      text: "Hindsight fits better.",
      sessionId,
      handoff: {
        id: "h1",
        kind: "result",
        bot: { id: "research", name: "Research" },
        title: "Compare Hindsight and Honcho",
        outcome: "completed",
      },
    });
  const deliveries = async () =>
    (await gateway.chats.state()).deliveries.filter((d) =>
      d.id.endsWith(":reply"),
    );
  try {
    const asked = await gateway.chats.send({
      source: "telegram",
      actor: "owner",
      eventId: "tg-1",
      text: "Ask @Research to compare them.",
      discordThreadId: "telegram:chat:42",
      connectionId: "tg",
      discordUserId: "42",
    });
    await settled();
    const before = (await deliveries()).length;
    const back = await result(1, asked.sessionId);
    await settled();
    const sent = (await deliveries()).find((d) => d.turnId === back.id);
    assert(sent, "the result's reply goes to Telegram");
    expect(sent.threadId).toBe("telegram:chat:42");
    expect(sent.connectionId).toBe("tg");
    expect(sent.text).toStartWith(
      "Research finished: Compare Hindsight and Honcho\n\n",
    );
    expect((await deliveries()).length).toBe(before + 1);

    // Once the owner carries on in the web workspace, results stay there.
    await gateway.chats.send({
      source: "web",
      actor: "owner",
      eventId: "web-1",
      text: "Thanks.",
      sessionId: asked.sessionId,
    });
    await settled();
    const stays = await result(2, asked.sessionId);
    await settled();
    expect((await deliveries()).some((d) => d.turnId === stays.id)).toBe(false);
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

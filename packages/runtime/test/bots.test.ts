import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { BotHost, type BotRuntime } from "../src/bootstrap/bot-host.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { BotProfileStore } from "../src/domains/bots/infrastructure/bot-profiles.ts";
import { RuntimeMemory } from "../src/domains/memory/infrastructure/runtime-memory.ts";
import { BackendSettings } from "../src/domains/settings/infrastructure/runtime-settings.ts";
import { chatModel } from "./chat-model.ts";
import { memoryCredentialKeyStore } from "./credential-store.ts";

const profile = {
  name: "Research",
  description: "Study sources carefully.",
  soul: "Explain evidence and uncertainty. Speak precisely.",
  color: "#83bcb4",
};

test("bot deletion confirms identity, removes only owned data and remains deleted after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-delete-bot-"));
  const open = async (botId: string, path: string) => {
    const gateway = await Gateway.open({
      directory: path,
      botId,
      deferResume: true,
      ...chatModel(),
    });
    return { gateway, close: () => gateway.close() };
  };
  const original = await open("default", directory);
  let host = await BotHost.open(directory, original, open);
  const server = await startServer(original.gateway, { port: 0, bots: host });
  try {
    const bot = await host.create(profile);
    const sibling = await host.create({ ...profile, name: "Keep" });
    const file = await host
      .runtime(bot.id)
      .gateway.files.put("owned.txt", new TextEncoder().encode("owned"));
    const keep = await original.gateway.files.put(
      "keep.txt",
      new TextEncoder().encode("keep"),
    );
    const remove = (id: string, input: unknown) =>
      fetch(`${server.url}/api/bots/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-Raphie-Client": "web",
        },
        body: JSON.stringify(input),
      });
    expect(
      (await remove("default", { name: "Raphie", revision: 1 })).status,
    ).toBe(409);
    expect((await remove(bot.id, { name: "wrong", revision: 1 })).status).toBe(
      409,
    );
    expect((await remove(bot.id, { name: bot.name, revision: 2 })).status).toBe(
      409,
    );
    expect((await remove(bot.id, { name: bot.name, revision: 1 })).status).toBe(
      204,
    );
    expect(
      await Bun.file(
        join(directory, "bots", bot.id, "gateway.sqlite"),
      ).exists(),
    ).toBe(false);
    expect(
      (await fetch(`${server.url}/api/bots/${bot.id}/files/${file.id}`)).status,
    ).toBe(404);
    expect(
      (await fetch(`${server.url}/api/bots/${bot.id}/history`)).status,
    ).toBe(404);
    expect((await remove(bot.id, { name: bot.name, revision: 1 })).status).toBe(
      404,
    );
    expect(
      new TextDecoder().decode(await original.gateway.files.read(keep.id)),
    ).toBe("keep");
    expect(host.read(sibling.id).name).toBe("Keep");
    await host.close();
    host = await BotHost.open(directory, original, open);
    expect(host.list().map((item) => item.id)).toEqual(["default", sibling.id]);
  } finally {
    await server.close();
    await host.close();
    await original.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("deletion recovery never reopens a marked bot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-delete-recovery-"));
  const opened: string[] = [];
  const open = async (botId: string, path: string) => {
    opened.push(botId);
    const gateway = await Gateway.open({
      directory: path,
      botId,
      deferResume: true,
      ...chatModel(),
    });
    return { gateway, close: () => gateway.close() };
  };
  const original = await open("default", directory);
  let host = await BotHost.open(directory, original, open);
  try {
    const bot = await host.create(profile);
    await host.close();
    const store = new BotProfileStore(join(directory, "bots.sqlite"));
    store.markDeleting(bot.id);
    store.close();
    opened.length = 0;
    host = await BotHost.open(directory, original, open);
    expect(opened).toEqual([]);
    expect(host.list().map((item) => item.id)).toEqual(["default"]);
    expect(
      await Bun.file(
        join(directory, "bots", bot.id, "gateway.sqlite"),
      ).exists(),
    ).toBe(false);
    expect(() => host.history(bot.id)).toThrow("not found");
  } finally {
    await host.close();
    await original.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed shutdown preserves the deletion marker and retries cleanup on restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-delete-failure-"));
  let failClose = true;
  const original = await Gateway.open({ directory, ...chatModel() });
  const open = async (botId: string, path: string) => {
    const gateway = await Gateway.open({
      directory: path,
      botId,
      deferResume: true,
      ...chatModel(),
    });
    return {
      gateway,
      close: async () => {
        if (failClose) {
          failClose = false;
          throw new Error("fixture shutdown failure");
        }
        await gateway.close();
      },
    };
  };
  let host = await BotHost.open(directory, { gateway: original }, open);
  try {
    const bot = await host.create(profile);
    const gateway = host.runtime(bot.id).gateway;
    const failure = await host
      .delete(bot.id, { name: bot.name, revision: 1 })
      .catch((error: Error) => error);
    expect(failure).toMatchObject({
      message: expect.stringContaining("pending cleanup"),
    });
    expect(gateway.configurationGate.run(async () => {})).rejects.toThrow(
      "being deleted",
    );
    expect(() => host.runtime(bot.id)).toThrow("not found");
    expect(
      await Bun.file(
        join(directory, "bots", bot.id, "workspace", "checkpoint.sqlite"),
      ).exists(),
    ).toBe(true);
    await host.close();
    host = await BotHost.open(directory, { gateway: original }, open);
    expect(host.list()).toHaveLength(1);
    expect(
      await Bun.file(
        join(directory, "bots", bot.id, "workspace", "checkpoint.sqlite"),
      ).exists(),
    ).toBe(false);
  } finally {
    failClose = false;
    await host.close();
    await original.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("deletion rejects pending turns and approvals and fences queued admission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-delete-busy-"));
  const generation = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const original = await Gateway.open({ directory, ...chatModel() });
  const open = async (botId: string, path: string) => {
    const gateway = await Gateway.open({
      directory: path,
      botId,
      deferResume: true,
      ...chatModel({
        pause: generation.promise,
        started: () => started.resolve(),
      }),
    });
    return { gateway, close: () => gateway.close() };
  };
  const host = await BotHost.open(directory, { gateway: original }, open);
  try {
    const bot = await host.create(profile);
    const gateway = host.runtime(bot.id).gateway;
    const input = { name: bot.name, revision: bot.revision };
    const file = await gateway.files.put(
      "approval.txt",
      new TextEncoder().encode("fixture"),
    );
    const approval = await gateway.sessions.copy(
      gateway.actors.establish("web"),
      { eventId: "copy", text: "copy", files: [file] },
    );
    expect(host.delete(bot.id, input)).rejects.toThrow("pending approvals");
    await gateway.sessions.decideFile(
      gateway.actors.establish("web"),
      approval,
      "rejected",
    );
    await gateway.chats.send({
      source: "web",
      actor: "owner",
      eventId: "busy",
      text: "wait",
    });
    await started.promise;
    expect(host.delete(bot.id, input)).rejects.toThrow("active turns");
    generation.resolve();
    for (
      let n = 0;
      n < 200 &&
      (await gateway.chats.state()).turns.some(
        (turn) => turn.status === "pending",
      );
      n++
    )
      await delay(10);
    const deletion = host.delete(bot.id, input);
    // This admission arrives behind the delete operation on the shared gate.
    expect(
      gateway.chats.send({
        source: "web",
        actor: "owner",
        eventId: "late",
        text: "too late",
      }),
    ).rejects.toThrow("Bot is being deleted");
    await deletion;
    expect(
      gateway.sessions.copy(gateway.actors.establish("web"), {
        eventId: "late-copy",
        text: "too late",
        files: [],
      }),
    ).rejects.toThrow("Bot is being deleted");
    expect(host.list()).toHaveLength(1);
  } finally {
    generation.resolve();
    await host.close();
    await original.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("bot containers preserve default data and isolate APIs, actors, credentials, memory and personality across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-bots-"));
  const keyStore = memoryCredentialKeyStore();
  const prompts: string[] = [];
  const open = async (botId: string, path: string): Promise<BotRuntime> => {
    const fixture = chatModel({ systemPrompt: (text) => prompts.push(text) });
    const provider = fixture.models.getProvider("fixture")!;
    fixture.models.setProvider({
      ...provider,
      id: "openrouter",
      getModels: () =>
        provider.getModels().map((m) => ({ ...m, provider: "openrouter" })),
    });
    const settings = await BackendSettings.open(join(path, "settings.sqlite"), {
      models: fixture.models,
      defaultModel: "history",
      credentialKeyStore: keyStore,
      verifyKey: async () => {},
    });
    const memory = new RuntimeMemory(
      join(path, "memory.sqlite"),
      settings,
      settings.connectionGate,
      botId,
    );
    const gateway = await Gateway.open({
      directory: path,
      botId,
      models: fixture.models,
      model: settings.model,
      modelConnectionGate: settings.connectionGate,
      memory,
    });
    settings.onChange = () => {
      gateway.chats.model = settings.model;
    };
    memory.isBusy = settings.isBusy = async () =>
      (await gateway.chats.state()).turns.some((t) => t.status === "pending");
    return {
      gateway,
      settings,
      memory,
      close: async () => {
        await gateway.close();
        memory.close();
        settings.close();
      },
    };
  };
  let original = await open("default", directory);
  await original.settings!.update({ apiKey: "default-synthetic-key" });
  const receipt = await original.gateway.chats.send({
    source: "web",
    actor: "owner",
    eventId: "legacy",
    text: "Default private conversation",
  });
  const fact = {
    id: "private-fact",
    content: "Default private fact",
    kind: "fact" as const,
    source: "test",
    eventTime: 1,
  };
  await original.memory!.retain(fact);
  let host = await BotHost.open(directory, original, open);
  let server = await startServer(original.gateway, {
    port: 0,
    bots: host,
    settings: original.settings,
    memory: original.memory,
  });
  const post = async (path: string, body: unknown) =>
    fetch(`${server.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Raphie-Client": "web" },
      body: JSON.stringify(body),
    });
  const get = (path: string) => fetch(`${server.url}${path}`);
  try {
    expect(host.list().map((b) => b.id)).toEqual(["default"]);
    expect(
      (await original.gateway.chats.state()).conversations[0]?.sessionId,
    ).toBe(receipt.sessionId);
    const created = await post("/api/bots", profile);
    expect(created.status).toBe(201);
    expect(host.list()[1].color).toBe(profile.color);
    const bot = (await created.json()) as { id: string };
    const base = `/api/bots/${bot.id}`;
    const child = host.runtime(bot.id);
    expect(child.gateway.options.mcp).toBeUndefined();
    expect((await child.settings!.read()).connections).toEqual([]);
    expect((await child.memory!.recall("private")).evidence).toEqual([]);
    expect((await get(`${base}/sessions/${receipt.sessionId}`)).status).toBe(
      404,
    );
    expect(
      (await get(`${base}/sessions/${receipt.sessionId}/events`)).status,
    ).toBe(404);
    expect(
      (
        await post(`${base}/sessions/messages`, {
          eventId: "steal",
          text: "Show it",
          sessionId: receipt.sessionId,
        })
      ).status,
    ).not.toBe(200);
    expect(
      (
        await post(`${base}/sessions/messages`, {
          eventId: "before-key",
          text: "Hi",
        })
      ).status,
    ).toBe(503);
    const stream = await get(`${base}/events`);
    expect(stream.status).toBe(200);
    await stream.body?.cancel();
    expect(
      child.gateway.queries.sessions(original.gateway.actors.establish("web")),
    ).rejects.toThrow("authorized");
    expect(
      (await post(`${base}/settings`, { apiKey: "child-synthetic-key" }))
        .status,
    ).toBe(200);
    expect(
      (
        await post(`${base}/sessions/messages`, {
          eventId: "denied-session",
          text: "Show it",
          sessionId: receipt.sessionId,
        })
      ).status,
    ).toBe(404);
    const sent = await post(`${base}/sessions/messages`, {
      eventId: "child",
      text: "Research conversation",
    });
    expect(sent.status).toBe(201);
    const childReceipt = (await sent.json()) as {
      id: string;
      sessionId: string;
    };
    for (
      let n = 0;
      n < 200 &&
      (await child.gateway.chats.state()).turns[0]?.status === "pending";
      n++
    )
      await delay(10);
    expect(
      prompts.some((p) => p.includes(profile.soul) && p.includes("Research")),
    ).toBe(true);
    expect((await get(`/api/sessions/${childReceipt.sessionId}`)).status).toBe(
      404,
    );
    const privateFile = await original.gateway.files.put(
      "private.txt",
      new TextEncoder().encode("Default private attachment"),
    );
    const fileApproval = await original.gateway.sessions.copy(
      original.gateway.actors.establish("web"),
      {
        eventId: "private-file",
        text: "Copy private file",
        files: [privateFile],
      },
    );
    expect((await get(`/api/files/${privateFile.id}`)).status).toBe(200);
    expect((await get(`${base}/files/${privateFile.id}`)).status).toBe(404);
    expect(
      (await get(`${base}/sessions/${receipt.sessionId}/history`)).status,
    ).toBe(404);
    expect(
      (await get(`${base}/sessions/${receipt.sessionId}/approvals`)).status,
    ).toBe(404);
    expect(
      child.gateway.sessions.decideFile(
        child.gateway.actors.establish("web"),
        fileApproval,
        "approved",
      ),
    ).rejects.toThrow("not found");
    expect((await get(`${base}/sessions`)).status).toBe(200);
    expect(await (await get(`${base}/sessions`)).json()).toMatchObject({
      items: [{ sessionId: childReceipt.sessionId }],
    });
    const revised = await post(`${base}/profile`, {
      ...profile,
      soul: "Use a calm, direct voice.",
      color: "#DDA6B5",
      revision: 1,
    });
    expect(revised.status).toBe(200);
    expect(host.read(bot.id).color).toBe("#dda6b5");
    expect(
      (await post(`${base}/profile`, { ...profile, revision: 1 })).status,
    ).toBe(409);
    expect(host.history(bot.id).map((b) => b.revision)).toEqual([2, 1]);
    await child.memory!.retain({ ...fact, content: "Child private fact" });
    expect(
      (await original.memory!.recall("private")).evidence[0]?.content,
    ).toBe(fact.content);
    await server.close();
    await host.close();
    await original.close();
    original = await open("default", directory);
    host = await BotHost.open(directory, original, open);
    server = await startServer(original.gateway, {
      port: 0,
      bots: host,
      settings: original.settings,
      memory: original.memory,
    });
    expect(host.list()).toHaveLength(2);
    expect(host.read(bot.id).revision).toBe(2);
    expect(host.read(bot.id).color).toBe("#dda6b5");
    expect(host.read("default").color).toBeUndefined();
    expect(host.history(bot.id).map((b) => b.color)).toEqual([
      "#dda6b5",
      profile.color,
    ]);
    expect(
      (await post(`${base}/profile`, { ...profile, color: "red", revision: 2 }))
        .status,
    ).toBe(400);
    expect(
      (await post(`${base}/profile`, { ...profile, color: null, revision: 2 }))
        .status,
    ).toBe(200);
    expect(host.read(bot.id).color).toBeNull();
    expect(
      (await original.gateway.chats.state()).conversations[0]?.sessionId,
    ).toBe(receipt.sessionId);
    expect(
      (await host.runtime(bot.id).memory!.recall("private")).evidence[0]
        ?.content,
    ).toBe("Child private fact");
    expect(
      (await get(`${base}/soul.md`)).headers.get("content-type"),
    ).toContain("text/plain");
    expect(
      (await post("/api/bots", { ...profile, id: "../default" })).status,
    ).toBe(400);
    expect((await get("/api/bots/unknown/sessions")).status).toBe(404);
  } finally {
    await server.close();
    await host.close();
    await original.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("personality edits serialize with admission and cannot change a pending turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-bot-personality-"));
  const generation = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const app = await Gateway.open({
    directory,
    ...chatModel({
      pause: generation.promise,
      started: () => started.resolve(),
    }),
  });
  const host = await BotHost.open(directory, { gateway: app });
  try {
    const turn = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: "pending",
      text: "Wait",
    });
    await started.promise;
    expect(host.update("default", { ...profile, revision: 1 })).rejects.toThrow(
      "active turns",
    );
    expect(host.read("default").revision).toBe(1);
    generation.resolve();
    for (
      let n = 0;
      n < 200 &&
      (await app.chats.state()).turns.find((t) => t.id === turn.id)?.status ===
        "pending";
      n++
    )
      await delay(10);
    expect(
      (await host.update("default", { ...profile, revision: 1 })).revision,
    ).toBe(2);
  } finally {
    generation.resolve();
    await host.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("external memory requests use separate bot namespaces even with the same user-selected scope and bank", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-bot-memory-scope-"));
  const requests: { tags: string[] }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push((await request.json()) as { tags: string[] });
      return Response.json({ results: [] });
    },
  });
  const secrets = { sealMemoryKey: () => null, openMemoryKey: () => null };
  const a = new RuntimeMemory(
    join(directory, "a.sqlite"),
    secrets,
    undefined,
    "research",
  );
  const b = new RuntimeMemory(
    join(directory, "b.sqlite"),
    secrets,
    undefined,
    "personal",
  );
  try {
    const configuration = {
      enabled: true,
      provider: "hindsight" as const,
      scope: "owner",
      endpoint: `http://127.0.0.1:${server.port}`,
      bankId: "shared",
    };
    await a.configure(configuration);
    await b.configure(configuration);
    await a.recall("tea");
    await b.recall("tea");
    expect(requests.map((request) => request.tags)).toEqual([
      ["raphie:bot_research_owner"],
      ["raphie:bot_personal_owner"],
    ]);
  } finally {
    a.close();
    b.close();
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { JsonObject } from "@earendil-works/pi-durable";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { RuntimeMemory } from "../src/domains/memory/infrastructure/runtime-memory.ts";
import { CredentialCipher } from "../src/domains/settings/infrastructure/credential-cipher.ts";
import { ModelConnectionGate } from "../src/shared/infrastructure/model-connection-gate.ts";
import { chatModel } from "./chat-model.ts";
import { memoryCredentialKeyStore } from "./credential-store.ts";

const builtin = {
  enabled: true,
  provider: "builtin" as const,
  scope: "owner",
  endpoint: "",
  bankId: "",
};
const evidence = {
  id: "source-1",
  content: "Owner prefers jasmine tea",
  kind: "fact" as const,
  source: "session:test/turn:1",
  eventTime: 1234,
};

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "raphie-memory-test-"));
  const cipher = await CredentialCipher.open(memoryCredentialKeyStore());
  const secrets = {
    sealMemoryKey: (value: string | null) =>
      cipher.encrypt(value, "memory-connection", "memory"),
    openMemoryKey: (value: Parameters<typeof cipher.decrypt>[0]) =>
      cipher.decrypt(value, "memory-connection", "memory"),
  };
  let memory = new RuntimeMemory(join(directory, "memory.sqlite"), secrets);
  return {
    directory,
    get memory() {
      return memory;
    },
    reopen() {
      memory.close();
      memory = new RuntimeMemory(join(directory, "memory.sqlite"), secrets);
    },
    async close() {
      memory.close();
      cipher.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("built-in memory starts enabled and preserves an explicit disabled setting after restart", async () => {
  const f = await fixture();
  try {
    expect(f.memory.read().configuration).toMatchObject({
      enabled: true,
      provider: "builtin",
      scope: "owner",
    });
    await f.memory.retain(evidence);
    await f.memory.configure({ ...builtin, enabled: false });
    f.reopen();
    expect(f.memory.read().configuration.enabled).toBe(false);
    expect(f.memory.recall("tea")).rejects.toThrow("disabled");
    await f.memory.configure(builtin);
    expect((await f.memory.recall("tea")).evidence[0]?.content).toBe(
      evidence.content,
    );
  } finally {
    await f.close();
  }
});

test("built-in evidence persists, isolates scope and never resurrects corrected or forgotten sources", async () => {
  const f = await fixture();
  try {
    await f.memory.configure(builtin);
    await f.memory.retain(evidence);
    await f.memory.retain(evidence);
    expect((await f.memory.recall("tea")).evidence).toEqual([
      { ...evidence, revision: 1 },
    ]);
    await f.memory.configure({ ...builtin, scope: "another" });
    expect((await f.memory.recall("tea")).evidence).toEqual([]);
    await f.memory.configure(builtin);
    await f.memory.revise(evidence.id, "Owner prefers coffee");
    await f.memory.retain(evidence);
    expect((await f.memory.recall("tea")).evidence).toEqual([]);
    expect((await f.memory.recall("coffee")).evidence[0]?.revision).toBe(2);
    f.reopen();
    expect((await f.memory.reflect("coffee")).evidence[0]?.content).toBe(
      "Owner prefers coffee",
    );
    await f.memory.forget(evidence.id);
    await f.memory.retain(evidence);
    f.reopen();
    expect((await f.memory.recall("coffee tea")).evidence).toEqual([]);
    expect((await f.memory.reflect("coffee")).answer).toContain(
      "No relevant evidence",
    );
  } finally {
    await f.close();
  }
});

test("browsing pages through every scoped memory in stable order, including after insertions", async () => {
  const f = await fixture();
  try {
    expect(await f.memory.browse()).toEqual({
      evidence: [],
      total: 0,
      next: null,
    });
    const records = Array.from({ length: 57 }, (_, index) => ({
      ...evidence,
      id: `record-${String(index).padStart(3, "0")}`,
      eventTime: 1000 + Math.floor(index / 3),
    }));
    for (const record of records) await f.memory.retain(record);
    const first = await f.memory.browse();
    expect(first.total).toBe(57);
    expect(first.evidence).toHaveLength(25);
    expect(first.next).not.toBeNull();
    await f.memory.retain({ ...evidence, id: "newest", eventTime: 99999 });
    const second = await f.memory.browse(first.next!);
    const third = await f.memory.browse(second.next!);
    expect(second.total).toBe(58);
    expect(second.evidence).toHaveLength(25);
    expect(third.evidence).toHaveLength(7);
    expect(third.next).toBeNull();
    const ids = [...first.evidence, ...second.evidence, ...third.evidence].map(
      (item) => item.id,
    );
    expect(ids).toEqual(records.toReversed().map((item) => item.id));
    await f.memory.revise("newest", "Corrected evidence");
    expect((await f.memory.browse()).evidence[0]?.content).toBe(
      "Corrected evidence",
    );
    await f.memory.forget("newest");
    expect((await f.memory.browse()).total).toBe(57);
    await f.memory.configure({ ...builtin, scope: "another" });
    expect((await f.memory.browse()).total).toBe(0);
    await f.memory.retain({ ...evidence, id: "other-scope" });
    expect((await f.memory.browse()).evidence.map((item) => item.id)).toEqual([
      "other-scope",
    ]);
    await f.memory.configure(builtin);
    expect((await f.memory.browse()).total).toBe(57);
    for (const cursor of [
      "not-json",
      Buffer.from("[12]").toString("base64url"),
      Buffer.from('[-1,"id"]').toString("base64url"),
      "a".repeat(1025),
    ])
      expect(f.memory.browse(cursor)).rejects.toThrow(
        "Invalid memory page cursor",
      );
  } finally {
    await f.close();
  }
});

test("memory configuration protects credentials, destination changes, and busy turns", async () => {
  const f = await fixture();
  try {
    f.memory.isBusy = async () => true;
    expect(f.memory.configure(builtin)).rejects.toThrow("active turns");
    f.memory.isBusy = async () => false;
    const external = {
      ...builtin,
      provider: "hindsight" as const,
      endpoint: "https://memory.example",
      bankId: "owner",
      apiKey: "synthetic-memory-key",
    };
    await f.memory.configure(external);
    const view = f.memory.read();
    expect(view.configuration.hasCredential).toBe(true);
    expect(JSON.stringify(view)).not.toContain(external.apiKey);
    expect(
      (await readFile(join(f.directory, "memory.sqlite-wal"))).includes(
        external.apiKey,
      ),
    ).toBe(false);
    f.reopen();
    expect(f.memory.read().configuration.provider).toBe("hindsight");
    const { apiKey: _, ...withoutKey } = external;
    expect(
      f.memory.configure({ ...withoutKey, endpoint: "https://other.example" }),
    ).rejects.toThrow("Re-enter or clear");
    for (const endpoint of [
      "http://remote.example",
      "https://user:secret@memory.example",
      "https://memory.example/?key=x",
      "file:///tmp/memory",
    ])
      expect(f.memory.configure({ ...external, endpoint })).rejects.toThrow();
    await f.memory.configure({ ...external, apiKey: null });
    expect(f.memory.read().configuration.hasCredential).toBe(false);
  } finally {
    await f.close();
  }
});

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: Error & { status?: number }) =>
      `${error.status ?? ""} ${error.message}`.trim(),
  );

const hindsight = {
  ...builtin,
  provider: "hindsight" as const,
  endpoint: "https://memory.example",
  bankId: "owner",
};

test("a saved Hindsight key never follows a destination changed while built-in is selected", async () => {
  const f = await fixture();
  try {
    await f.memory.configure({ ...hindsight, apiKey: "synthetic-memory-key" });
    // Built-in has no destination; the saved Hindsight one is kept.
    await f.memory.configure({ ...builtin, endpoint: "https://evil.example" });
    expect(f.memory.read().configuration.endpoint).toBe(hindsight.endpoint);
    expect(
      await failure(
        f.memory.configure({ ...hindsight, endpoint: "https://evil.example" }),
      ),
    ).toContain("Re-enter or clear");
    // Switching back to the destination the key was saved for keeps the key.
    await f.memory.configure(hindsight);
    expect(f.memory.read().configuration.hasCredential).toBe(true);
  } finally {
    await f.close();
  }
});

test("forgetting an unknown memory reports not found and changes nothing", async () => {
  const f = await fixture();
  try {
    await f.memory.retain(evidence);
    expect(await failure(f.memory.forget("made-up-id"))).toBe(
      "404 Memory not found in this scope.",
    );
    expect((await f.memory.recall("jasmine")).evidence).toHaveLength(1);
    await f.memory.forget(evidence.id);
    expect(await failure(f.memory.forget(evidence.id))).toContain("404");
  } finally {
    await f.close();
  }
});

test("an undecryptable saved key leaves the runtime starting, with only Hindsight unavailable", async () => {
  const f = await fixture();
  try {
    await f.memory.configure({ ...hindsight, apiKey: "synthetic-memory-key" });
    f.memory.close();
    const broken = {
      sealMemoryKey: () => null,
      openMemoryKey: (value: unknown) => {
        if (value) throw new Error("cannot decrypt");
        return null;
      },
    };
    const memory = new RuntimeMemory(
      join(f.directory, "memory.sqlite"),
      broken,
    );
    try {
      expect(memory.read().error).toContain("cannot be decrypted");
      expect(await failure(memory.recall("tea"))).toContain(
        "503 The saved Hindsight API key cannot be decrypted",
      );
      // Built-in memory keeps working.
      await memory.configure(builtin);
      expect(memory.read().error).toBeNull();
      await memory.retain(evidence);
      expect((await memory.recall("jasmine")).evidence).toHaveLength(1);
    } finally {
      memory.close();
    }
  } finally {
    f.reopen();
    await f.close();
  }
});

test("slow Hindsight calls do not hold the gate that admits chat messages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-memory-gate-"));
  const gate = new ModelConnectionGate();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch() {
      await delay(400);
      return Response.json({ results: [] });
    },
  });
  const memory = new RuntimeMemory(
    join(directory, "memory.sqlite"),
    { sealMemoryKey: () => null, openMemoryKey: () => null },
    gate,
  );
  try {
    await memory.configure({
      ...hindsight,
      endpoint: `http://127.0.0.1:${server.port}`,
    });
    const recall = memory.recall("tea");
    await delay(50);
    const started = performance.now();
    await gate.run(async () => {});
    expect(performance.now() - started).toBeLessThan(150);
    expect((await recall).evidence).toEqual([]);
  } finally {
    memory.close();
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("Hindsight uses synchronous, scoped API calls and never follows credential redirects", async () => {
  const f = await fixture();
  const calls: { path: string; body: unknown; authorization: string | null }[] =
    [];
  let mode = "ok";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const body =
        request.method === "POST" ? ((await request.json()) as unknown) : null;
      calls.push({
        path,
        body,
        authorization: request.headers.get("Authorization"),
      });
      if (mode === "redirect")
        return Response.redirect("http://127.0.0.1:1/leak");
      if (mode === "fail")
        return new Response("synthetic-memory-key", { status: 500 });
      if (mode === "malformed") return Response.json({ unexpected: true });
      if (path.endsWith("/recall"))
        return Response.json({
          results: [
            {
              id: "fact-1",
              text: "tea",
              document_id: "owner:source-1",
              metadata: { source: evidence.source, eventTime: "1234" },
            },
          ],
        });
      if (path.endsWith("/reflect"))
        return Response.json({
          text: "Prefers tea",
          based_on: { memories: [{ id: "fact-1", text: "tea" }] },
        });
      return Response.json({ success: true, async: false });
    },
  });
  try {
    await f.memory.configure({
      ...builtin,
      provider: "hindsight",
      endpoint: `http://127.0.0.1:${server.port}`,
      bankId: "private-bank",
      apiKey: "synthetic-memory-key",
    });
    expect(f.memory.read().capabilities.browse).toBe(false);
    expect(f.memory.browse()).rejects.toThrow("not supported");
    await f.memory.test();
    await f.memory.retain(evidence);
    expect(calls.at(-1)?.body).toMatchObject({
      async: false,
      items: [
        {
          document_id: "owner:source-1",
          tags: ["raphie:owner"],
          metadata: { source: evidence.source },
        },
      ],
    });
    const recalled = await f.memory.recall("tea");
    expect(recalled.evidence[0]?.source).toBe(evidence.source);
    expect(calls.at(-1)?.body).toMatchObject({
      tags: ["raphie:owner"],
      tags_match: "all_strict",
      types: ["world", "experience"],
    });
    expect((await f.memory.reflect("preferences")).mode).toBe("provider");
    expect(calls.at(-1)?.body).toMatchObject({
      include: { facts: {} },
      tags_match: "all_strict",
    });
    expect(
      calls.every((c) => c.path.startsWith("/v1/default/banks/private-bank")),
    ).toBe(true);
    expect(
      calls.every((c) => c.authorization === "Bearer synthetic-memory-key"),
    ).toBe(true);
    for (const failure of ["redirect", "fail", "malformed"]) {
      mode = failure;
      expect(f.memory.recall("tea")).rejects.toThrow(/Hindsight/);
    }
    expect(f.memory.read().configuration.provider).toBe("hindsight");
    await f.memory.configure(builtin);
    expect((await f.memory.recall("tea")).evidence).toEqual([]);
  } finally {
    await server.stop(true);
    await f.close();
  }
});

test("memory tools retain host provenance and recall in a new Pi session after restart", async () => {
  const f = await fixture();
  let app: Gateway | undefined;
  try {
    await f.memory.configure(builtin);
    app = await Gateway.open({
      directory: f.directory,
      memory: f.memory,
      ...chatModel({
        tool: {
          name: "memory_retain",
          args: { content: evidence.content, kind: "fact" },
        },
      }),
    });
    const first = await app.chats.send({
      source: "web",
      eventId: "remember",
      actor: "owner",
      text: "Remember I prefer jasmine tea",
    });
    for (
      let n = 0;
      n < 200 && (await app.chats.state()).turns[0]?.status === "pending";
      n++
    )
      await delay(10);
    expect((await app.chats.state()).turns[0]?.answer).toContain(
      '"retained":true',
    );
    const saved = (await f.memory.recall("tea")).evidence[0];
    expect(saved?.source).toBe(`session:${first.sessionId}/turn:${first.id}`);
    await app.close();
    app = undefined;
    f.reopen();
    app = await Gateway.open({
      directory: f.directory,
      memory: f.memory,
      ...chatModel({ tool: { name: "memory_recall", args: { query: "tea" } } }),
    });
    const second = await app.chats.send({
      source: "web",
      eventId: "recall",
      actor: "owner",
      text: "What tea do I like?",
    });
    for (
      let n = 0;
      n < 200 &&
      (await app.chats.state()).turns.find((t) => t.id === second.id)
        ?.status === "pending";
      n++
    )
      await delay(10);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(
      (await app.chats.state()).turns.find((t) => t.id === second.id)?.answer,
    ).toContain("jasmine tea");
  } finally {
    await app?.close();
    await f.close();
  }
});

test("memory HTTP endpoints share local access protection and expose no key", async () => {
  const f = await fixture();
  const app = await Gateway.open({ directory: f.directory, ...chatModel() });
  const server = await startServer(app, { port: 0, memory: f.memory });
  try {
    const url = `${server.url}/api/memory`;
    const denied = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify(builtin),
    });
    expect(denied.status).toBe(403);
    await f.memory.configure(builtin);
    await f.memory.retain(evidence);
    const page = await fetch(`${url}/evidence`);
    expect(await page.json()).toEqual({
      evidence: [{ ...evidence, revision: 1 }],
      total: 1,
      next: null,
    });
    expect((await fetch(`${url}/evidence?after=invalid`)).status).toBe(400);
    const post = (path: string, body: unknown) =>
      fetch(`${url}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Raphie-Client": "web",
        },
        body: JSON.stringify(body),
      });
    // Unknown IDs are "not found", never a reported success.
    expect((await post("/evidence/made-up/forget", {})).status).toBe(404);
    expect((await post("/evidence/made-up", { content: "x" })).status).toBe(
      404,
    );
    // The one configuration schema rejects an empty key at the boundary.
    expect((await post("", { ...builtin, apiKey: "" })).status).toBe(400);
    expect((await post(`/evidence/${evidence.id}/forget`, {})).status).toBe(
      200,
    );
    const read = await fetch(url);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      configuration: { enabled: true, hasCredential: false },
    });
  } finally {
    await server.close();
    await app.close();
    await f.close();
  }
});

test("SIGKILL after retention does not replay the unfinished memory tool", async () => {
  const f = await fixture();
  const child = spawn(
    process.execPath,
    [
      new URL("./memory-crash-worker.ts", import.meta.url).pathname,
      f.directory,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let app: Gateway | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("memory-written")) resolve();
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`Memory worker exited before writing: ${code}`)),
      );
    });
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    f.reopen();
    let repeats = 0;
    const retain = f.memory.retain.bind(f.memory);
    f.memory.retain = async (input) => {
      repeats++;
      await retain(input);
    };
    app = await Gateway.open({
      directory: f.directory,
      memory: f.memory,
      ...chatModel({
        tool: {
          name: "memory_retain",
          args: { content: evidence.content, kind: "fact" },
        },
      }),
    });
    for (
      let n = 0;
      n < 200 && (await app.chats.state()).turns[0]?.status === "pending";
      n++
    )
      await delay(10);
    expect((await app.chats.state()).turns[0]?.status).not.toBe("pending");
    expect(repeats).toBe(0);
    expect((await f.memory.recall("tea")).evidence).toHaveLength(1);
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await app?.close();
    await f.close();
  }
}, 10000);

test("memory configuration rejects changes during a real pending turn and permits them after completion", async () => {
  const f = await fixture();
  const generation = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const gate = new ModelConnectionGate();
  const memory = new RuntimeMemory(
    join(f.directory, "busy-memory.sqlite"),
    { sealMemoryKey: () => null, openMemoryKey: () => null },
    gate,
  );
  const app = await Gateway.open({
    directory: f.directory,
    memory,
    modelConnectionGate: gate,
    ...chatModel({
      pause: generation.promise,
      started: () => started.resolve(),
    }),
  });
  // Match production wiring, reading persisted turns rather than stubbing isBusy.
  memory.isBusy = async () =>
    (await app.chats.state()).turns.some((turn) => turn.status === "pending");
  try {
    const turn = await app.chats.send({
      source: "web",
      eventId: "memory-busy",
      actor: "owner",
      text: "Hold this turn open",
    });
    await started.promise;
    expect(
      (await app.chats.state()).turns.find((t) => t.id === turn.id)?.status,
    ).toBe("pending");
    expect(
      await failure(memory.configure({ ...builtin, scope: "changed" })),
    ).toContain("409");
    expect(memory.read().configuration.scope).toBe("owner");
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
      (await app.chats.state()).turns.find((t) => t.id === turn.id)?.status,
    ).toBe("done");
    await memory.configure({ ...builtin, scope: "changed" });
    expect(memory.read().configuration.scope).toBe("changed");
  } finally {
    generation.resolve();
    await app.close();
    memory.close();
    await f.close();
  }
});

test("agent tools revise and forget evidence with persisted results and useful errors", async () => {
  const f = await fixture();
  let app: Gateway | undefined;
  try {
    await f.memory.retain(evidence);
    const operations: { name: string; args: JsonObject; expected: string }[] = [
      {
        name: "memory_revise",
        args: { id: evidence.id, content: "Owner prefers coffee" },
        expected: '"updated":true',
      },
      {
        name: "memory_forget",
        args: { id: evidence.id },
        expected: '"forgotten":true',
      },
      {
        name: "memory_forget",
        args: { id: evidence.id },
        expected: "Memory not found in this scope",
      },
    ];
    for (const operation of operations) {
      app = await Gateway.open({
        directory: f.directory,
        memory: f.memory,
        ...chatModel({ tool: { name: operation.name, args: operation.args } }),
      });
      const turn = await app.chats.send({
        source: "web",
        eventId: crypto.randomUUID(),
        actor: "owner",
        text: operation.name,
      });
      for (
        let n = 0;
        n < 200 &&
        (await app.chats.state()).turns.find((t) => t.id === turn.id)
          ?.status === "pending";
        n++
      )
        await delay(10);
      expect(
        (await app.chats.state()).turns.find((t) => t.id === turn.id)?.answer,
      ).toContain(operation.expected);
      await app.close();
      app = undefined;
      f.reopen();
      if (operation.name === "memory_revise") {
        expect((await f.memory.recall("tea")).evidence).toEqual([]);
        expect((await f.memory.recall("coffee")).evidence).toEqual([
          { ...evidence, content: "Owner prefers coffee", revision: 2 },
        ]);
      } else {
        expect((await f.memory.browse()).total).toBe(0);
      }
    }
    // An old retain receipt cannot restore evidence forgotten by an agent.
    await f.memory.retain(evidence);
    expect((await f.memory.browse()).total).toBe(0);
  } finally {
    await app?.close();
    await f.close();
  }
});

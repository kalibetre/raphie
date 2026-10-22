import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { RuntimeMemory } from "../src/domains/memory/infrastructure/runtime-memory.ts";
import { CredentialCipher } from "../src/domains/settings/infrastructure/credential-cipher.ts";
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

test("built-in evidence persists, isolates scope and never resurrects corrected or forgotten sources", async () => {
  const f = await fixture();
  try {
    expect(f.memory.recall("tea")).rejects.toThrow("disabled");
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

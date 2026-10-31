import { test } from "bun:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { BackendWorkspace } from "../src/infrastructure/http/backend-workspace";

test("observations recover from a terminal EventSource failure without reloading or replaying commands", async () => {
  const original = globalThis.EventSource;
  const streams: MockEvents[] = [];

  class MockEvents {
    static readonly CLOSED = 2;
    readyState = 0;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;

    constructor(readonly path: string) {
      streams.push(this);
    }

    close() {
      this.readyState = MockEvents.CLOSED;
    }
  }

  globalThis.EventSource = MockEvents as unknown as typeof EventSource;
  const workspace = new BackendWorkspace("http://127.0.0.1:4317", "research");
  let connected = false;
  const messages: string[] = [];
  const stop = workspace.observe("/api/sessions/events", {
    open: () => {
      connected = true;
    },
    error: () => {
      connected = false;
    },
    message: (event) => messages.push(event.data),
  });
  try {
    streams[0].onopen?.();
    assert.equal(connected, true);
    // EOF normally leaves EventSource reconnecting; no second stream is needed.
    streams[0].onerror?.();
    await delay(1100);
    assert.equal(streams.length, 1);
    assert.equal(connected, false);
    // A retry while the backend is down receives HTTP 503 and closes permanently.
    streams[0].readyState = MockEvents.CLOSED;
    streams[0].onerror?.();
    streams[0].onerror?.();
    await delay(1100);
    assert.equal(streams.length, 2, "a closed SSE connection must be replaced");
    assert.equal(streams[1].path, streams[0].path);
    assert.match(streams[1].path, /\/api\/bots\/research\/sessions\/events/);
    assert.equal(
      new URL(streams[1].path, "http://localhost").searchParams.get(
        "_raphie_backend",
      ),
      workspace.url,
    );
    streams[1].onopen?.();
    streams[1].onmessage?.(
      new MessageEvent("message", { data: "fresh snapshot" }),
    );
    assert.equal(connected, true);
    assert.deepEqual(messages, ["fresh snapshot"]);
    const queued = streams[1].onmessage;
    streams[1].readyState = MockEvents.CLOSED;
    streams[1].onerror?.();
    stop();
    queued?.(new MessageEvent("message", { data: "stale snapshot" }));
    await delay(1100);
    assert.equal(
      streams.length,
      2,
      "unsubscribing must cancel scheduled retries",
    );
    assert.deepEqual(messages, ["fresh snapshot"]);
    workspace.observe("/api/sessions/saved/events", { message: () => {} });
    streams[2].readyState = MockEvents.CLOSED;
    streams[2].onerror?.();
    workspace.dispose();
    await delay(1100);
    assert.equal(streams.length, 3, "retiring a workspace must cancel retries");
  } finally {
    stop();
    workspace.dispose();
    globalThis.EventSource = original;
  }
}, 8000);

test("bot workspaces scope requests, streams, drafts and caches independently", async () => {
  const originalFetch = globalThis.fetch;
  const originalEvents = globalThis.EventSource;
  const paths: string[] = [];
  let finish!: (response: Response) => void;
  let lastStream = "";
  globalThis.fetch = (async (path: string) => {
    paths.push(path);
    if (path.endsWith("/slow"))
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    return Response.json({ path });
  }) as unknown as typeof fetch;
  globalThis.EventSource = class {
    constructor(path: string) {
      lastStream = path;
    }

    close() {}
  } as unknown as typeof EventSource;
  const a = new BackendWorkspace("http://127.0.0.1:4317", "bot-a");
  const b = new BackendWorkspace("http://127.0.0.1:4317", "bot-b");
  try {
    a.queries.setQueryData(["memory-settings"], { owner: "a" });
    assert.equal(b.queries.getQueryData(["memory-settings"]), undefined);
    assert.notEqual(a.draftKey(), b.draftKey());
    await a.api("/api/settings");
    await b.api("/api/sessions");
    await a.api("/api/bots");
    assert.deepEqual(paths, [
      "/api/bots/bot-a/settings",
      "/api/bots/bot-b/sessions",
      "/api/bots",
    ]);
    a.observe("/api/sessions/events", { message: () => {} });
    assert.equal(
      new URL(lastStream, "http://localhost").pathname,
      "/api/bots/bot-a/sessions/events",
    );
    const pending = a.api("/api/slow");
    const rejection = assert.rejects(pending, /changed/);
    a.dispose();
    finish(Response.json({ bot: "a" }));
    await rejection;
    await b.api("/api/memory");
    assert.equal(paths.at(-1), "/api/bots/bot-b/memory");
  } finally {
    a.dispose();
    b.dispose();
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEvents;
  }
});

test("binary downloads stay pinned to their bot/backend and retired downloads cannot save stale responses", async () => {
  const original = globalThis.fetch;
  const workspace = new BackendWorkspace("http://127.0.0.1:16316", "research");
  let finish!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  globalThis.fetch = (async (path: string, options?: RequestInit) => {
    assert.equal(
      path,
      "/api/bots/research/workspace/download?path=%2Fworkspace%2Fa&revision=1",
    );
    assert.equal(
      new Headers(options?.headers).get("x-raphie-backend"),
      workspace.url,
    );
    signal = options?.signal ?? undefined;
    return new Promise((resolve) => {
      finish = resolve;
    });
  }) as typeof fetch;
  try {
    const path = "/api/workspace/download?path=%2Fworkspace%2Fa&revision=1";
    const good = workspace.download(path);
    finish(new Response(new Uint8Array([0, 255])));
    assert.deepEqual(
      [...new Uint8Array(await (await good).arrayBuffer())],
      [0, 255],
    );
    const pending = workspace.download(path);
    const rejected = assert.rejects(pending, /changed/);
    workspace.dispose();
    assert.equal(signal?.aborted, true);
    finish(new Response("stale bytes"));
    await rejected;
  } finally {
    workspace.dispose();
    globalThis.fetch = original;
  }
});

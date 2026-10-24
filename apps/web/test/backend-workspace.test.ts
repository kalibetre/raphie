import { test } from "bun:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import {
  BackendWorkspace,
  connectWorkspace,
} from "../src/infrastructure/http/backend-workspace";

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

test("Connect replaces backend state through an in-app route transition and retires old requests and streams", async () => {
  const originalFetch = globalThis.fetch;
  let selected = "http://127.0.0.1:4337";
  let oldSignal: AbortSignal | undefined;
  let finishOld!: (value: Response) => void;
  const requests: string[] = [];
  globalThis.fetch = (async (path: string, options?: RequestInit) => {
    requests.push(path);
    if (path === "/api/web/connection") {
      const input = JSON.parse(options!.body as string);
      if (input.action === "connect") selected = input.url;
      return Response.json({ url: input.url, connected: true });
    }
    if (path === "/api/slow") {
      oldSignal = options?.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        finishOld = resolve;
      });
    }
    return Response.json({ backend: selected });
  }) as unknown as typeof fetch;
  const old = new BackendWorkspace(selected);
  old.queries.setQueryData(["session", "same-id"], { backend: "old" });
  old.queries.setQueryData(["runtime-settings"], { model: "old-model" });
  const pending = old.api("/api/slow");
  const rejected = assert.rejects(pending, /backend|abort/i);
  let closed = false;
  // Exercise the real stream handlers, including a queued event after close.
  const originalEventSource = globalThis.EventSource;
  let stream!: EventSource;
  globalThis.EventSource = class {
    close() {
      closed = true;
    }

    constructor() {
      stream = this as unknown as EventSource;
    }
  } as unknown as typeof EventSource;
  let events = 0;
  old.observe("/api/sessions/events", { message: () => events++ });
  const queued = stream.onmessage!;
  let current: BackendWorkspace | undefined = old;
  let routes = 0;
  try {
    const next = await connectWorkspace(old, "http://127.0.0.1:4338", {
      publish: (value) => {
        current = value;
      },
      navigate: async () => {
        routes++;
        assert.equal(current, undefined);
      },
    });
    assert.equal(current, next);
    assert.equal(closed, true);
    assert.equal(oldSignal?.aborted, true);
    queued.call(stream, new MessageEvent("message", { data: "old" }));
    assert.equal(events, 0);
    finishOld(Response.json({ backend: "old" }));
    await rejected;
    assert.equal(old.queries.getQueryCache().getAll().length, 0);
    assert.equal(next.queries.getQueryData(["session", "same-id"]), undefined);
    assert.equal(next.queries.getQueryData(["runtime-settings"]), undefined);
    const count = requests.length;
    await assert.rejects(
      old.api("/api/tool-approvals/old", { decision: "approved" }),
      /backend|abort/i,
    );
    assert.equal(requests.length, count);
    assert.deepEqual(await next.api("/api/runtime"), { backend: selected });
    assert.notEqual(old.draftKey("same-id"), next.draftKey("same-id"));
    assert.equal(routes, 1);
    next.dispose();
  } finally {
    old.dispose();
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
  }
});

test("failed probes preserve the active backend, cache, and route", async () => {
  const originalFetch = globalThis.fetch;
  const old = new BackendWorkspace("http://127.0.0.1:4337");
  old.queries.setQueryData(["runtime-info"], { model: "old" });
  globalThis.fetch = (async () =>
    Response.json(
      { error: "Offline" },
      { status: 503 },
    )) as unknown as typeof fetch;
  try {
    await assert.rejects(
      connectWorkspace(old, "http://127.0.0.1:4338", {
        publish: () => assert.fail("must keep current workspace"),
        navigate: async () => assert.fail("must keep current route"),
      }),
      /Offline/,
    );
    assert.deepEqual(old.queries.getQueryData(["runtime-info"]), {
      model: "old",
    });
  } finally {
    old.dispose();
    globalThis.fetch = originalFetch;
  }
});

for (const saved of ["http://127.0.0.1:4337", "http://127.0.0.1:4338", null]) {
  test(`failed commit reconciles the selection before resuming: ${saved ?? "unknown"}`, async () => {
    const originalFetch = globalThis.fetch;
    const old = new BackendWorkspace("http://127.0.0.1:4337");
    let current: BackendWorkspace | undefined = old;
    let routes = 0;
    globalThis.fetch = (async (_path: string, options?: RequestInit) => {
      if (!options?.body) {
        if (!saved) throw new Error("Readback unavailable");
        return Response.json({ url: saved });
      }
      const input = JSON.parse(options.body as string);
      if (input.action === "test") return Response.json({ connected: true });
      throw new Error("Commit response lost");
    }) as unknown as typeof fetch;
    try {
      await assert.rejects(
        connectWorkspace(old, "http://127.0.0.1:4338", {
          publish: (next) => {
            current = next;
          },
          navigate: async () => {
            routes++;
          },
        }),
        /lost|unavailable/,
      );
      assert.equal(current?.url, saved ?? undefined);
      assert.equal(routes, saved === "http://127.0.0.1:4338" ? 1 : 0);
      await assert.rejects(
        old.api("/api/sessions/messages", { text: "old" }),
        /backend|abort/i,
      );
    } finally {
      current?.dispose();
      old.dispose();
      globalThis.fetch = originalFetch;
    }
  });
}

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

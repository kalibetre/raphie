import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  BackendWorkspace,
  connectWorkspace,
} from "../src/infrastructure/http/backend-workspace";

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

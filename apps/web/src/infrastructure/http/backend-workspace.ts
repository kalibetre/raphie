import { QueryClient } from "@tanstack/react-query";

import { api } from "./api-client";

/** A retired workspace can never issue commands against a newly selected backend. */
export class BackendWorkspace {
  readonly queries = new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 1000 } },
  });
  private readonly lifetime = new AbortController();
  private readonly streams = new Set<EventSource>();

  readonly botId: string;

  constructor(
    readonly url: string,
    botId = "default",
  ) {
    this.botId = botId;
  }

  private scopedPath(path: string) {
    if (
      this.botId === "default" ||
      path.startsWith("/api/bots") ||
      path.startsWith("/api/web/")
    )
      return path;
    if (!path.startsWith("/api/"))
      throw new Error("Bot requests must use the runtime API.");
    return `/api/bots/${encodeURIComponent(this.botId)}${path.slice(4)}`;
  }

  readonly api = async <T>(path: string, data?: unknown): Promise<T> => {
    this.assertActive();
    const result = await api<T>(
      this.scopedPath(path),
      data,
      this.lifetime.signal,
      this.url || undefined,
    );
    // Even a response already queued before abort must not resume an old action.
    this.assertActive();
    return result;
  };

  assertActive() {
    this.lifetime.signal.throwIfAborted();
  }

  observe(
    path: string,
    handlers: {
      open?: () => void;
      error?: () => void;
      message: (event: MessageEvent) => void;
    },
  ) {
    this.assertActive();
    const address = new URL(this.scopedPath(path), "http://localhost");
    if (this.url) address.searchParams.set("_raphie_backend", this.url);
    const events = new EventSource(address.pathname + address.search);
    this.streams.add(events);
    events.onopen = () => {
      if (!this.lifetime.signal.aborted) handlers.open?.();
    };
    events.onerror = () => {
      if (!this.lifetime.signal.aborted) handlers.error?.();
    };
    events.onmessage = (event) => {
      if (!this.lifetime.signal.aborted) handlers.message(event);
    };
    return () => {
      events.close();
      this.streams.delete(events);
    };
  }

  draftKey(sessionId?: string) {
    const bot = this.botId === "default" ? "" : `bot:${this.botId}:`;
    return `raphie:draft:${encodeURIComponent(this.url)}:${bot}${sessionId ?? "new"}`;
  }

  dispose() {
    this.lifetime.abort(
      new DOMException("The backend workspace changed.", "AbortError"),
    );
    for (const stream of this.streams) stream.close();
    this.streams.clear();
    this.queries.clear();
  }
}

/** Probe before retiring state; stop all old work before the selection cookie changes. */
export async function connectWorkspace(
  current: BackendWorkspace,
  url: string,
  transition: {
    publish: (workspace: BackendWorkspace | undefined) => void;
    navigate: () => Promise<void>;
  },
) {
  await api("/api/web/connection", { action: "test", url });
  current.dispose();
  transition.publish(undefined);
  let selected = current.url;
  try {
    const result = await api<{ url: string }>("/api/web/connection", {
      action: "connect",
      url,
    });
    selected = result.url;
    await transition.navigate();
  } catch (error) {
    // A lost response may still have saved the cookie. Read it back before
    // resuming; if that fails, stay suspended rather than guess a backend.
    const saved = await api<{ url: string }>("/api/web/connection");
    if (saved.url !== current.url) await transition.navigate();
    transition.publish(new BackendWorkspace(saved.url));
    throw error;
  }
  const next = new BackendWorkspace(selected);
  transition.publish(next);
  return next;
}

import { QueryClient } from "@tanstack/react-query";

import { api, ApiError } from "./api-client";

/** A retired workspace can never issue commands against a newly selected backend. */
export class BackendWorkspace {
  readonly queries = new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 1000 } },
  });
  private readonly lifetime = new AbortController();
  private readonly observations = new Set<() => void>();

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

  /** Binary downloads retain the same bot/backend scope and cancellation as JSON reads. */
  readonly download = async (path: string): Promise<Blob> => {
    this.assertActive();
    const response = await fetch(this.scopedPath(path), {
      signal: this.lifetime.signal,
      headers: this.url ? { "x-raphie-backend": this.url } : {},
    });
    if (!response.ok) {
      const result = await response.json();
      this.assertActive();
      throw new ApiError(
        result.error ?? "File download failed.",
        response.status,
        result.code ?? "request_failed",
      );
    }
    const blob = await response.blob();
    this.assertActive();
    return blob;
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
    let events: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1000;
    let stopped = false;
    const stop = () => {
      stopped = true;
      clearTimeout(retry);
      events?.close();
      this.observations.delete(stop);
    };
    const connect = () => {
      if (stopped || this.lifetime.signal.aborted) return;
      const stream = new EventSource(address.pathname + address.search);
      events = stream;
      const active = () =>
        !stopped && !this.lifetime.signal.aborted && events === stream;
      stream.onopen = () => {
        if (!active()) return;
        retryDelay = 1000;
        handlers.open?.();
      };
      stream.onerror = () => {
        if (!active()) return;
        handlers.error?.();
        // EOF uses native retries, but a non-SSE response (such as a 503
        // during restart) permanently closes EventSource. Replace that one.
        if (stream.readyState === EventSource.CLOSED && retry === undefined) {
          stream.close();
          retry = setTimeout(() => {
            retry = undefined;
            connect();
          }, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 15_000);
        }
      };
      stream.onmessage = (event) => {
        if (active()) handlers.message(event);
      };
    };
    this.observations.add(stop);
    connect();
    return stop;
  }

  draftKey(sessionId?: string) {
    const bot = this.botId === "default" ? "" : `bot:${this.botId}:`;
    return `raphie:draft:${encodeURIComponent(this.url)}:${bot}${sessionId ?? "new"}`;
  }

  dispose() {
    this.lifetime.abort(
      new DOMException("The backend workspace changed.", "AbortError"),
    );
    for (const stop of this.observations) stop();
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

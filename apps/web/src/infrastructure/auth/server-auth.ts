export function deviceToken(request: Request): string {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("raphie_device="))
      ?.slice("raphie_device=".length) ?? ""
  );
}

export function nativeToken(request: Request): string {
  return (
    /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
      request.headers.get("authorization") ?? "",
    )?.[1] ?? ""
  );
}

/** Stop observing when a session is revoked, even if the upstream is idle. */
export function guardEventStream(
  response: Response,
  store: { valid(token: string): boolean },
  token: string,
  intervalMs = 1000,
): Response {
  if (
    !response.body ||
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("text/event-stream")
  )
    return response;
  const reader = response.body.getReader();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        void reader.cancel().catch(() => {});
        controller.close();
      };
      timer = setInterval(() => {
        try {
          if (!store.valid(token)) stop();
        } catch {
          stop();
        }
      }, intervalMs);
      void (async () => {
        try {
          while (!closed) {
            const result = await reader.read();
            if (closed) return;
            if (result.done || !store.valid(token)) {
              stop();
              return;
            }
            controller.enqueue(result.value);
          }
        } catch {
          stop();
        }
      })();
    },
    cancel() {
      closed = true;
      clearInterval(timer);
      return reader.cancel();
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

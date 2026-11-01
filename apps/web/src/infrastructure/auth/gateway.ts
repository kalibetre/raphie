import type { AuthService } from "./auth-service.ts";

/** Returned for requests that may continue to the application. */
export type Admission = {
  /** Refreshed session cookies Better Auth wants the browser to store. */
  cookies: string[];
  /** Re-reads the session from the database. Null for public pages. */
  stillValid: (() => Promise<boolean>) | null;
};

const SAFE_METHODS = ["GET", "HEAD"];
const AUTH_BODY_LIMIT = 8 * 1024;
const noStore = { "cache-control": "no-store" };

const json = (
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
) => Response.json(body, { status, headers: { ...noStore, ...headers } });

const isEventStream = (response: Response) =>
  response.body !== null &&
  response.headers
    .get("content-type")
    ?.toLowerCase()
    .startsWith("text/event-stream") === true;

/** Bound input before buffering even when Content-Length is absent or false. */
async function boundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return result + decoder.decode();
      size += value.byteLength;
      if (size > AUTH_BODY_LIMIT) {
        await reader.cancel();
        return null;
      }
      result += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * The single front door of the web host. Every request is checked here before
 * the application, runtime proxy or an event stream can see it; the only
 * public surface is the login page, its static assets, and the sign-in and
 * sign-out endpoints. A failure to check is a refusal, never an admission.
 */
export function createGateway(options: {
  service: Pick<
    AuthService,
    | "configured"
    | "handle"
    | "handleDevice"
    | "session"
    | "devices"
    | "revokeDevice"
  >;
  origins: string[];
  /** How often an open event stream re-reads its session. */
  streamCheckMs?: number;
}) {
  const { service, origins } = options;
  const hosts = origins.map((origin) => new URL(origin).host);

  function denyUnauthenticated(request: Request, url: URL, locked: boolean) {
    const navigation =
      request.method === "GET" &&
      !url.pathname.startsWith("/api/") &&
      (request.headers.get("sec-fetch-mode") === "navigate" ||
        request.headers.get("accept")?.includes("text/html"));
    if (navigation) {
      const next = encodeURIComponent(url.pathname + url.search);
      return new Response(null, {
        status: 303,
        headers: { ...noStore, location: `/login?next=${next}` },
      });
    }
    return locked
      ? json(
          {
            error:
              "Raphie is locked. Create the administrator with `raphie auth setup`.",
            code: "locked",
          },
          503,
        )
      : json({ error: "Sign in to continue.", code: "unauthenticated" }, 401);
  }

  /** Better Auth only sees what it needs; forwarded-address headers are never trusted. */
  async function signInOrOut(request: Request, url: URL) {
    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, 405);
    const text = await boundedBody(request);
    if (text === null) return json({ error: "Request too large." }, 413);
    const headers = new Headers({ "x-forwarded-for": "127.0.0.1" });
    for (const name of ["content-type", "cookie", "origin"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const response = await service.handle(
      new Request(url, { method: "POST", headers, body: text }),
    );
    const result = new Response(response.body, response);
    result.headers.set("cache-control", "no-store");
    return result;
  }

  async function nativeDeviceRequest(request: Request, url: URL) {
    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, 405);
    if (
      request.headers.has("origin") ||
      request.headers.has("cookie") ||
      request.headers.has("authorization") ||
      request.headers.has("sec-fetch-site")
    )
      return json(
        { error: "Native requests cannot include browser credentials." },
        403,
      );
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      return json({ error: "Expected JSON." }, 415);
    if (!service.configured()) return denyUnauthenticated(request, url, true);
    const text = await boundedBody(request);
    if (text === null) return json({ error: "Request too large." }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return json({ error: "Invalid request." }, 400);
    const allowed = url.pathname.endsWith("/code")
      ? ["client_id"]
      : ["client_id", "device_code", "grant_type"];
    if (Object.keys(body).some((key) => !allowed.includes(key)))
      return json({ error: "Invalid request." }, 400);
    const headers = new Headers({
      "content-type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    });
    const agent = request.headers.get("user-agent");
    if (agent) headers.set("user-agent", agent.slice(0, 256));
    const result = await service.handleDevice(
      new Request(url, { method: "POST", headers, body: text }),
    );
    const response = new Response(result.body, result);
    response.headers.set("cache-control", "no-store");
    return response;
  }

  return {
    /** A Response refuses the request; an Admission lets it continue. */
    async check(request: Request): Promise<Response | Admission> {
      try {
        const url = new URL(request.url);
        if (!hosts.includes(url.host))
          return new Response("Unrecognized host.", { status: 403 });
        const path = url.pathname;
        if (
          path === "/api/auth/device/code" ||
          path === "/api/auth/device/token"
        )
          return await nativeDeviceRequest(request, url);
        const native =
          path.startsWith("/api/") &&
          !path.startsWith("/api/auth/") &&
          !request.headers.has("origin") &&
          !request.headers.has("cookie") &&
          !request.headers.has("sec-fetch-site") &&
          /^Bearer [^\s]+$/.test(request.headers.get("authorization") ?? "");
        if (!SAFE_METHODS.includes(request.method)) {
          const origin = request.headers.get("origin");
          if (!native && (!origin || !origins.includes(origin)))
            return json({ error: "Unrecognized request origin." }, 403);
        }
        const configured = service.configured();
        if (path === "/auth/status" && request.method === "GET") {
          const session = configured
            ? await service.session(request.headers)
            : null;
          return json({ configured, authenticated: session !== null }, 200);
        }
        if (path === "/_raphie/health" && request.method === "GET")
          return json({ status: configured ? "ready" : "locked" }, 200);
        if (path.startsWith("/api/auth/") || path === "/api/auth") {
          if (
            path === "/api/auth/authorized-devices" ||
            path === "/api/auth/authorized-devices/revoke" ||
            path === "/api/auth/device" ||
            path === "/api/auth/device/approve" ||
            path === "/api/auth/device/deny"
          ) {
            const site = request.headers.get("sec-fetch-site");
            const suppliedOrigin = request.headers.get("origin");
            if (
              (site && site !== "same-origin" && site !== "none") ||
              (suppliedOrigin && !origins.includes(suppliedOrigin))
            )
              return json({ error: "Unrecognized request origin." }, 403);
            if (
              request.headers.has("authorization") ||
              !request.headers.has("cookie") ||
              !(await service.session(
                new Headers({ cookie: request.headers.get("cookie")! }),
              ))
            )
              return json({ error: "Sign in to continue." }, 401);
            if (!configured) return denyUnauthenticated(request, url, true);
            if (path === "/api/auth/authorized-devices")
              return request.method === "GET"
                ? json(service.devices(), 200)
                : json({ error: "Method not allowed." }, 405);
            if (path === "/api/auth/authorized-devices/revoke") {
              if (request.method !== "POST")
                return json({ error: "Method not allowed." }, 405);
              const text = await boundedBody(request);
              if (text === null)
                return json({ error: "Request too large." }, 413);
              let body: unknown;
              try {
                body = JSON.parse(text);
              } catch {
                return json({ error: "Invalid JSON." }, 400);
              }
              if (
                !body ||
                typeof body !== "object" ||
                Array.isArray(body) ||
                Object.keys(body).join() !== "id" ||
                typeof (body as { id?: unknown }).id !== "string" ||
                (body as { id: string }).id.length > 128
              )
                return json({ error: "Invalid request." }, 400);
              return service.revokeDevice((body as { id: string }).id)
                ? json({ success: true }, 200)
                : json({ error: "Device not found." }, 404);
            }
            if (path === "/api/auth/device" && request.method === "GET") {
              const codes = url.searchParams.getAll("user_code");
              if (
                codes.length !== 1 ||
                !/^[A-Za-z0-9-]{6,32}$/.test(codes[0]!) ||
                [...url.searchParams.keys()].some((key) => key !== "user_code")
              )
                return json({ error: "Invalid device code." }, 400);
              const headers = new Headers({
                cookie: request.headers.get("cookie")!,
                "x-forwarded-for": "127.0.0.1",
              });
              const result = await service.handle(
                new Request(url, { headers }),
              );
              const response = new Response(result.body, result);
              response.headers.set("cache-control", "no-store");
              return response;
            }
            if (
              path === "/api/auth/device/approve" ||
              path === "/api/auth/device/deny"
            )
              return await signInOrOut(request, url);
            return json({ error: "Method not allowed." }, 405);
          }
          if (
            path !== "/api/auth/sign-in/email" &&
            path !== "/api/auth/sign-out"
          )
            return json({ error: "Not found." }, 404);
          return configured
            ? await signInOrOut(request, url)
            : denyUnauthenticated(request, url, true);
        }
        if (
          SAFE_METHODS.includes(request.method) &&
          (path === "/login" || path.startsWith("/assets/"))
        )
          return { cookies: [], stillValid: null };
        if (!configured) return denyUnauthenticated(request, url, true);
        if (request.headers.has("authorization") && !native)
          return json({ error: "Unrecognized credentials." }, 403);
        const session = await service.session(request.headers);
        if (!session) return denyUnauthenticated(request, url, false);
        return {
          cookies: native ? [] : session.cookies,
          stillValid: async () =>
            (await service.session(request.headers)) !== null,
        };
      } catch {
        return json(
          { error: "Authentication is unavailable.", code: "auth_unavailable" },
          503,
        );
      }
    },

    /** Applies cookie refreshes and ends event streams whose session was revoked. */
    finish(response: Response, admission: Admission): Response {
      if (!admission.cookies.length && !admission.stillValid) return response;
      const result = new Response(response.body, response);
      for (const cookie of admission.cookies)
        result.headers.append("set-cookie", cookie);
      if (admission.stillValid && isEventStream(response))
        return guardEventStream(
          result,
          admission.stillValid,
          options.streamCheckMs ?? 2000,
        );
      return result;
    },
  };
}

export type Gateway = ReturnType<typeof createGateway>;

/** Stops relaying when the session is revoked, even if the upstream is idle. */
export function guardEventStream(
  response: Response,
  stillValid: () => Promise<boolean>,
  intervalMs: number,
): Response {
  const reader = response.body!.getReader();
  let timer: ReturnType<typeof setInterval> | undefined;
  let finished = false;
  let checking = false;
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stop = () => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        void reader.cancel().catch(() => {});
        try {
          controller.close();
        } catch {
          /* Already closed by the consumer. */
        }
      };
      timer = setInterval(() => {
        if (checking) return;
        checking = true;
        void stillValid()
          .then((valid) => !valid && stop())
          .catch(stop)
          .finally(() => {
            checking = false;
          });
      }, intervalMs);
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (finished) return;
        if (chunk.done) stop();
        else controller.enqueue(chunk.value);
      } catch {
        stop();
      }
    },
    cancel() {
      finished = true;
      clearInterval(timer);
      return reader.cancel();
    },
  });
  return new Response(body, response);
}

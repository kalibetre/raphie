import type { OwnerStore } from "./owner-store.ts";

const loginPage = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in · Raphie</title><style>body{font:16px system-ui;background:#141413;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}main{width:min(24rem,calc(100% - 3rem));padding:2rem;border:1px solid #444;border-radius:12px;background:#20201f}h1{font-size:1.5rem}label{display:block;margin:1rem 0 .4rem}input,button{box-sizing:border-box;width:100%;padding:.7rem;font:inherit;border-radius:6px}input{background:#111;color:#fff;border:1px solid #666}button{margin-top:1.5rem;border:0;background:#e9c99b;color:#181512;font-weight:600}p{color:#d5c7bc}</style></head><body><main><h1>Sign in to Raphie</h1><p>Use the owner account configured on this server.</p><form method="post" action="/auth/login"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button>Sign in</button></form></main></body></html>`;
const accountPage = loginPage
  .replace("Sign in · Raphie", "Owner account · Raphie")
  .replace("Sign in to Raphie", "Owner account")
  .replace(
    "Use the owner account configured on this server.",
    "Changing credentials signs out all sessions.",
  )
  .replace('action="/auth/login"', 'action="/auth/account"')
  .replace("Username</label>", "New username</label>")
  .replace("Password</label>", "Current password</label>")
  .replace(
    "<button>Sign in</button>",
    '<label for="new-password">New password</label><input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="12" required><label for="confirm-password">Confirm new password</label><input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required><button>Change credentials</button>',
  );

export function sessionToken(request: Request): string {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("raphie_session="))
      ?.slice("raphie_session=".length) ?? ""
  );
}

/** Stop observing when a session is revoked, even if the upstream is idle. */
export function guardEventStream(
  response: Response,
  store: OwnerStore,
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

/** Server mode is opt-in and requires an exact browser-facing origin. */
export function serverAuth(store: OwnerStore, origin: string) {
  const url = new URL(origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== origin ||
    url.username ||
    url.password
  )
    throw new Error("Server mode requires an exact HTTP or HTTPS origin.");
  if (!store.configured())
    throw new Error("Server owner account is not configured.");
  const secure = url.protocol === "https:" ? "; Secure" : "";
  const cookie = (value: string) =>
    `raphie_session=${value}; HttpOnly; SameSite=Strict; Path=/${secure}`;
  let attempts: number[] = [];
  let activeLogins = 0;
  return async (request: Request): Promise<Response | null> => {
    const incoming = new URL(request.url);
    if (incoming.host !== url.host)
      return new Response("Unrecognized host.", { status: 403 });
    const suppliedOrigin = request.headers.get("origin");
    if (
      (suppliedOrigin && suppliedOrigin !== origin) ||
      (!["GET", "HEAD"].includes(request.method) && suppliedOrigin !== origin)
    )
      return new Response("Unrecognized origin.", { status: 403 });
    const token = sessionToken(request);
    const authenticated = store.valid(token);
    if (
      incoming.pathname === "/auth/status" &&
      request.method === "GET" &&
      authenticated
    )
      return Response.json(
        { enabled: true },
        { headers: { "cache-control": "no-store" } },
      );
    if (incoming.pathname === "/auth/login" && request.method === "GET")
      return new Response(loginPage, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        },
      });
    if (incoming.pathname === "/auth/login" && request.method === "POST") {
      const now = Date.now();
      attempts = attempts.filter((at) => at > now - 60_000);
      if (attempts.length >= 10 || activeLogins >= 2)
        return new Response("Please try again later.", {
          status: 429,
          headers: { "retry-after": "60" },
        });
      attempts.push(now);
      if (Number(request.headers.get("content-length") ?? 0) > 4096)
        return new Response("Invalid request.", { status: 400 });
      const body = await request.text();
      if (body.length > 4096)
        return new Response("Invalid request.", { status: 400 });
      const form = new URLSearchParams(body);
      activeLogins++;
      try {
        const session = await store.signIn(
          form.get("username") ?? "",
          form.get("password") ?? "",
        );
        if (!session)
          return new Response("Invalid username or password.", {
            status: 401,
            headers: { "cache-control": "no-store" },
          });
        return new Response(null, {
          status: 303,
          headers: {
            location: "/",
            "set-cookie": cookie(session),
            "cache-control": "no-store",
          },
        });
      } finally {
        activeLogins--;
      }
    }
    if (incoming.pathname === "/auth/logout" && request.method === "POST") {
      if (authenticated) store.signOut(token);
      return new Response(null, {
        status: 303,
        headers: {
          location: "/auth/login",
          "set-cookie": `${cookie("")}; Max-Age=0`,
          "cache-control": "no-store",
        },
      });
    }
    if (
      authenticated &&
      incoming.pathname === "/auth/account" &&
      request.method === "GET"
    )
      return new Response(accountPage, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        },
      });
    if (
      authenticated &&
      incoming.pathname === "/auth/account" &&
      request.method === "POST"
    ) {
      const now = Date.now();
      attempts = attempts.filter((at) => at > now - 60_000);
      if (attempts.length >= 10 || activeLogins >= 2)
        return new Response("Please try again later.", { status: 429 });
      attempts.push(now);
      if (Number(request.headers.get("content-length") ?? 0) > 4096)
        return new Response("Invalid request.", { status: 400 });
      const body = await request.text();
      if (body.length > 4096)
        return new Response("Invalid request.", { status: 400 });
      const form = new URLSearchParams(body);
      const password = form.get("newPassword") ?? "";
      activeLogins++;
      try {
        if (
          password !== form.get("confirmPassword") ||
          !(await store.changeOwner(
            form.get("password") ?? "",
            form.get("username") ?? "",
            password,
          ))
        )
          return new Response(
            "Could not change credentials. Check the current password and new values.",
            { status: 400, headers: { "cache-control": "no-store" } },
          );
        return new Response(null, {
          status: 303,
          headers: {
            location: "/auth/login",
            "set-cookie": `${cookie("")}; Max-Age=0`,
            "cache-control": "no-store",
          },
        });
      } finally {
        activeLogins--;
      }
    }
    if (!authenticated) {
      if (incoming.pathname.startsWith("/api/"))
        return Response.json(
          { error: "Sign in required." },
          { status: 401, headers: { "cache-control": "no-store" } },
        );
      return new Response(null, {
        status: 303,
        headers: { location: "/auth/login", "cache-control": "no-store" },
      });
    }
    return null;
  };
}

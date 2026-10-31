import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startWebServer } from "../src/bootstrap/http-server.ts";
import {
  type AuthService,
  openAuthService,
} from "../src/infrastructure/auth/auth-service.ts";
import { createGateway } from "../src/infrastructure/auth/gateway.ts";

const origin = "http://127.0.0.1:4320";
const origins = [origin, "http://localhost:4320"];
const email = "admin@example.test";
const password = "a long test password";
const directories: string[] = [];
const services: AuthService[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "raphie-auth-"));
  directories.push(directory);
  const open = async (role: "server" | "admin", allowed = origins) => {
    const service = await openAuthService({
      directory,
      origins: allowed,
      role,
    });
    services.push(service);
    return service;
  };
  return { directory, open };
}

afterEach(async () => {
  for (const service of services.splice(0)) service.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const request = (path: string, init: RequestInit = {}, host = origin) =>
  new Request(`${host}${path}`, init);

const signIn = (
  gateway: ReturnType<typeof createGateway>,
  secret = password,
  headers: Record<string, string> = {},
) =>
  gateway.check(
    request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin, ...headers },
      body: JSON.stringify({ email, password: secret }),
    }),
  ) as Promise<Response>;

const cookieOf = (response: Response) =>
  response.headers.getSetCookie()[0]!.split(";")[0]!;

test("a host with no administrator refuses everything except the login page", async () => {
  const { open } = await fixture();
  const gateway = createGateway({ service: await open("server"), origins });

  const api = (await gateway.check(request("/api/sessions"))) as Response;
  expect(api.status).toBe(503);
  expect((await api.json()).code).toBe("locked");
  const page = (await gateway.check(
    request("/", { headers: { accept: "text/html" } }),
  )) as Response;
  expect([page.status, page.headers.get("location")]).toEqual([
    303,
    "/login?next=%2F",
  ]);
  expect(await gateway.check(request("/login"))).not.toBeInstanceOf(Response);
  const attempt = (await signIn(gateway)) as Response;
  expect(attempt.status).toBe(503);
  const health = (await gateway.check(request("/_raphie/health"))) as Response;
  expect(await health.json()).toEqual({ status: "locked" });
});

test("the running host notices the administrator created by the command line", async () => {
  const { open } = await fixture();
  const gateway = createGateway({ service: await open("server"), origins });
  const status = async () =>
    ((await gateway.check(request("/auth/status"))) as Response).json();
  expect(await status()).toEqual({ configured: false, authenticated: false });
  await (await open("admin")).setup(email, password);
  expect(await status()).toEqual({ configured: true, authenticated: false });
});

test("sign-in grants a persistent session that logout and restarts treat correctly", async () => {
  const { open } = await fixture();
  await (await open("admin")).setup(email, password);
  const first = createGateway({ service: await open("server"), origins });

  expect(((await signIn(first, "wrong password")) as Response).status).toBe(
    401,
  );
  const login = await signIn(first);
  expect(login.status).toBe(200);
  const setCookie = login.headers.getSetCookie()[0]!;
  expect(setCookie).toMatch(/^raphie_4320\.session_token=/);
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/Max-Age=2592000/i);
  const cookie = cookieOf(login);

  const refused = (await first.check(request("/api/sessions"))) as Response;
  expect(refused.status).toBe(401);
  expect(
    await first.check(request("/api/sessions", { headers: { cookie } })),
  ).not.toBeInstanceOf(Response);

  // A restart keeps the session: it is stored, not held in memory.
  services.splice(0).forEach((service) => service.close());
  const restarted = createGateway({ service: await open("server"), origins });
  expect(
    await restarted.check(request("/api/sessions", { headers: { cookie } })),
  ).not.toBeInstanceOf(Response);

  const out = (await restarted.check(
    request("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: "{}",
    }),
  )) as Response;
  expect(out.status).toBe(200);
  const after = (await restarted.check(
    request("/api/sessions", { headers: { cookie } }),
  )) as Response;
  expect(after.status).toBe(401);
});

test("hosts, origins and non-login Better Auth routes are refused", async () => {
  const { open } = await fixture();
  await (await open("admin")).setup(email, password);
  const service = await open("server");
  const gateway = createGateway({ service, origins });
  const login = await signIn(gateway);
  const cookie = cookieOf(login);
  const status = async (response: Promise<unknown>) =>
    ((await response) as Response).status;

  expect(
    await status(
      gateway.check(
        request(
          "/api/sessions",
          { headers: { cookie } },
          "http://evil.example",
        ),
      ),
    ),
  ).toBe(403);
  expect(
    await status(
      gateway.check(
        request("/api/chat", {
          method: "POST",
          headers: { cookie, origin: "http://evil.example" },
        }),
      ),
    ),
  ).toBe(403);
  // Cookies are not enough for a state change without a same-origin Origin.
  expect(
    await status(
      gateway.check(
        request("/api/chat", { method: "POST", headers: { cookie } }),
      ),
    ),
  ).toBe(403);
  expect(
    await gateway.check(
      request("/api/chat", { method: "POST", headers: { cookie, origin } }),
    ),
  ).not.toBeInstanceOf(Response);

  for (const path of [
    "/api/auth/sign-up/email",
    "/api/auth/request-password-reset",
    "/api/auth/reset-password",
    "/api/auth/list-sessions",
    "/api/auth/revoke-sessions",
    "/api/auth/change-password",
  ])
    expect(
      await status(
        gateway.check(
          request(path, {
            method: "POST",
            headers: { cookie, origin },
            body: "{}",
          }),
        ),
      ),
    ).toBe(404);
  // Even if a route were exposed, a server instance cannot create users or resets.
  for (const path of [
    "/api/auth/sign-up/email",
    "/api/auth/request-password-reset",
  ]) {
    const direct = await service.handle(
      request(path, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({
          email: "other@example.test",
          password,
          name: "x",
        }),
      }),
    );
    expect(direct.ok).toBe(false);
  }
});

test("recovery replaces the password and signs every browser out", async () => {
  const { open } = await fixture();
  const admin = await open("admin");
  await admin.setup(email, password);
  const gateway = createGateway({ service: await open("server"), origins });
  const cookie = cookieOf(await signIn(gateway));
  expect(
    await gateway.check(request("/api/sessions", { headers: { cookie } })),
  ).not.toBeInstanceOf(Response);

  await assert.rejects(admin.recover("short"));
  await admin.recover("a brand new password");

  const revoked = (await gateway.check(
    request("/api/sessions", { headers: { cookie } }),
  )) as Response;
  expect(revoked.status).toBe(401);
  expect(((await signIn(gateway)) as Response).status).toBe(401);
  expect(
    ((await signIn(gateway, "a brand new password")) as Response).status,
  ).toBe(200);
});

test("only one administrator can ever be created, even by racing commands", async () => {
  const { directory, open } = await fixture();
  const [a, b] = [await open("admin"), await open("admin")];
  const results = await Promise.allSettled([
    a.setup("one@example.test", password),
    b.setup("two@example.test", password),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  await assert.rejects(
    a.setup("three@example.test", password),
    /already configured/,
  );
  const database = new Database(join(directory, "auth.sqlite"), {
    readonly: true,
  });
  expect(database.query('SELECT COUNT(*) AS n FROM "user"').get()).toEqual({
    n: 1,
  });
  expect(database.query('SELECT COUNT(*) AS n FROM "account"').get()).toEqual({
    n: 1,
  });
  expect(database.query('SELECT COUNT(*) AS n FROM "session"').get()).toEqual({
    n: 0,
  });
  database.close();
});

test("repeated failed sign-ins are limited regardless of forwarded addresses", async () => {
  const { open } = await fixture();
  await (await open("admin")).setup(email, password);
  const gateway = createGateway({ service: await open("server"), origins });
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 7; attempt++)
    statuses.push(
      (
        (await signIn(gateway, "wrong password", {
          "x-forwarded-for": `203.0.113.${attempt}`,
        })) as Response
      ).status,
    );
  expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);
  // The limit shields the password: even the right one waits.
  expect(((await signIn(gateway)) as Response).status).toBe(429);
});

test("an open event stream ends when its session is revoked", async () => {
  const { open } = await fixture();
  const admin = await open("admin");
  await admin.setup(email, password);
  const gateway = createGateway({
    service: await open("server"),
    origins,
    streamCheckMs: 20,
  });
  const cookie = cookieOf(await signIn(gateway));
  const admission = await gateway.check(
    request("/api/sessions/events", { headers: { cookie } }),
  );
  if (admission instanceof Response) throw new Error("Expected admission.");
  let upstreamCancelled = false;
  const upstream = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
      },
      cancel() {
        upstreamCancelled = true;
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  const reader = gateway.finish(upstream, admission).body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(
    "data: hello\n\n",
  );

  await admin.recover("a brand new password");
  const ended = await Promise.race([
    reader.read().then((chunk) => chunk.done),
    Bun.sleep(2000).then(() => "still open"),
  ]);
  expect(ended).toBe(true);
  expect(upstreamCancelled).toBe(true);
});

test("the production host serves nothing before the gateway admits it", async () => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const hostOrigin = `http://127.0.0.1:${probe.port}`;
  await probe.stop(true);
  const { open } = await fixture();
  await (await open("admin", [hostOrigin])).setup(email, password);
  const service = await open("server", [hostOrigin]);
  const client = await mkdtemp(join(tmpdir(), "raphie-client-"));
  directories.push(client);
  await Bun.write(join(client, "assets", "app.js"), "console.log('app')");
  await Bun.write(join(client, "secret.txt"), "not public");
  await Bun.write(join(client, ".private"), "hidden");
  const server = startWebServer({
    gateway: createGateway({ service, origins: [hostOrigin] }),
    clientDirectory: client,
    port: Number(new URL(hostOrigin).port),
    build: { id: "fixture", version: "v1" },
    fetch: (incoming) => new Response(`SSR ${new URL(incoming.url).pathname}`),
  });
  try {
    const status = async (path: string, headers: HeadersInit = {}) =>
      (await fetch(`${hostOrigin}${path}`, { headers })).status;
    for (const path of [
      "/api/sessions",
      "/_raphie/version",
      "/secret.txt",
      "/sessions/x",
    ])
      expect(await status(path)).toBe(401);
    expect(await status("/assets/app.js")).toBe(200);
    expect(await (await fetch(`${hostOrigin}/login`)).text()).toBe(
      "SSR /login",
    );
    expect(await (await fetch(`${hostOrigin}/_raphie/health`)).json()).toEqual({
      status: "ready",
    });

    const login = await fetch(`${hostOrigin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: hostOrigin },
      body: JSON.stringify({ email, password }),
    });
    expect(login.status).toBe(200);
    const cookie = cookieOf(login);
    expect(
      await (
        await fetch(`${hostOrigin}/_raphie/version`, { headers: { cookie } })
      ).json(),
    ).toEqual({ id: "fixture", version: "v1" });
    expect(
      await (
        await fetch(`${hostOrigin}/sessions/x`, { headers: { cookie } })
      ).text(),
    ).toBe("SSR /sessions/x");
    expect(await status("/.private", { cookie })).toBe(404);
    const foreign = await new Promise<number | undefined>((resolve, reject) => {
      get(
        `${hostOrigin}/`,
        { headers: { Host: "evil.example", cookie } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      ).on("error", reject);
    });
    expect(foreign).toBe(403);
  } finally {
    await server.stop(true);
  }
});

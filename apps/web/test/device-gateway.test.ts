import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startWebServer } from "../src/bootstrap/http-server.ts";
import {
  type AuthService,
  openAuthService,
} from "../src/infrastructure/auth/auth-service.ts";
import { createGateway } from "../src/infrastructure/auth/gateway.ts";

const origin = "http://127.0.0.1:4320";
const opened: AuthService[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const service of opened.splice(0)) service.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "raphie-device-"));
  directories.push(directory);
  const admin = await openAuthService({
    directory,
    origins: [origin],
    role: "admin",
  });
  const server = await openAuthService({
    directory,
    origins: [origin],
    role: "server",
  });
  opened.push(admin, server);
  await admin.setup("admin@example.test", "a long test password");
  const gateway = createGateway({
    service: server,
    origins: [origin],
    streamCheckMs: 20,
  });
  const check = (path: string, init: RequestInit = {}) =>
    gateway.check(new Request(origin + path, init));
  const json = (body: unknown, headers: Record<string, string> = {}) => ({
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const login = (await check(
    "/api/auth/sign-in/email",
    json(
      { email: "admin@example.test", password: "a long test password" },
      { origin },
    ),
  )) as Response;
  const cookie = login.headers.getSetCookie()[0]!.split(";")[0]!;
  return { check, json, cookie, server, admin, gateway, directory };
}

test("a browser explicitly approves a native device and can revoke it independently", async () => {
  const { check, json, cookie, gateway, directory } = await fixture();
  const issued = (await check(
    "/api/auth/device/code",
    json({ client_id: "raphie-native" }),
  )) as Response;
  expect(issued.status).toBe(200);
  const code = (await issued.json()) as {
    device_code: string;
    user_code: string;
  };
  const verification = (await check(
    `/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`,
    { headers: { cookie } },
  )) as Response;
  expect(verification.status).toBe(200);
  const approve = (await check(
    "/api/auth/device/approve",
    json({ userCode: code.user_code }, { origin, cookie }),
  )) as Response;
  expect(approve.status).toBe(200);
  const redeemed = (await check(
    "/api/auth/device/token",
    json(
      {
        client_id: "raphie-native",
        device_code: code.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      },
      { "user-agent": "Raphie test client" },
    ),
  )) as Response;
  expect(redeemed.status).toBe(200);
  const { access_token: token } = (await redeemed.json()) as {
    access_token: string;
  };
  const admission = await check("/api/runtime", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(admission).not.toBeInstanceOf(Response);
  if (admission instanceof Response)
    throw new Error("Expected device admission.");
  let cancelled = false;
  const stream = gateway.finish(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("ready"));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    ),
    admission,
  );
  const reader = stream.body!.getReader();
  await reader.read();
  const peer = await openAuthService({
    directory,
    origins: [origin],
    role: "server",
  });
  opened.push(peer);
  const peerGateway = createGateway({ service: peer, origins: [origin] });
  const peerCheck = (path: string, init: RequestInit = {}) =>
    peerGateway.check(new Request(origin + path, init));
  const listed = (await peerCheck("/api/auth/authorized-devices", {
    headers: { cookie },
  })) as Response;
  const devices = (await listed.json()) as { id: string; name: string }[];
  expect(devices).toHaveLength(1);
  expect(JSON.stringify(devices)).not.toContain(token);
  expect(devices[0]!.name).toBe("Raphie test client");
  expect(
    (
      (await peerCheck(
        "/api/auth/authorized-devices/revoke",
        json({ id: devices[0]!.id }, { origin, cookie }),
      )) as Response
    ).status,
  ).toBe(200);
  expect(
    (
      (await check(
        "/api/auth/device/approve",
        json(
          { userCode: code.user_code },
          { origin, authorization: `Bearer ${token}` },
        ),
      )) as Response
    ).status,
  ).toBe(401);
  expect((await reader.read()).done).toBe(true);
  expect(cancelled).toBe(true);
  expect(
    (
      (await check("/api/runtime", {
        headers: { authorization: `Bearer ${token}` },
      })) as Response
    ).status,
  ).toBe(401);
  expect(
    (
      (await check("/api/auth/device", {
        headers: { cookie, "sec-fetch-site": "cross-site" },
      })) as Response
    ).status,
  ).toBe(403);
  expect(
    (
      (await check(
        "/api/auth/device/code",
        json({ client_id: "raphie-native", padding: "x".repeat(9000) }),
      )) as Response
    ).status,
  ).toBe(413);
  expect(
    await check("/api/runtime", { headers: { cookie } }),
  ).not.toBeInstanceOf(Response);
  expect(
    (
      (await check(
        "/api/auth/device/token",
        json({
          client_id: "raphie-native",
          device_code: code.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      )) as Response
    ).status,
  ).not.toBe(200);
});

test("device endpoints reject browser-origin, mixed credentials and unapproved clients", async () => {
  const { check, json, cookie } = await fixture();
  for (const path of ["/api/auth/sign-in/email", "/api/auth/sign-out"]) {
    expect(
      (
        (await check(
          path,
          json({}, { authorization: "Bearer invalid" }),
        )) as Response
      ).status,
    ).toBe(403);
  }
  expect(
    (
      (await check(
        "/api/auth/device/code",
        json({ client_id: "untrusted" }),
      )) as Response
    ).status,
  ).not.toBe(200);
  expect(
    (
      (await check(
        "/api/auth/device/code",
        json({ client_id: "raphie-native" }, { origin, cookie }),
      )) as Response
    ).status,
  ).toBe(403);
  expect(
    (
      (await check(
        "/api/auth/device/code",
        json({ client_id: "raphie-native", user_id: "attacker" }),
      )) as Response
    ).status,
  ).toBe(400);
  expect(
    (
      (await check(
        "/api/auth/device/approve",
        json({ userCode: "ABCDEFGH" }, { origin }),
      )) as Response
    ).status,
  ).toBe(401);
  expect(
    (
      (await check("/api/auth/authorized-devices", {
        headers: { authorization: "Bearer invalid" },
      })) as Response
    ).status,
  ).toBe(401);
});

test("denying a device request never issues a usable session", async () => {
  const { check, json, cookie } = await fixture();
  const issued = (await check(
    "/api/auth/device/code",
    json({ client_id: "raphie-native" }),
  )) as Response;
  const code = (await issued.json()) as {
    user_code: string;
    device_code: string;
  };
  expect(
    (
      (await check(
        `/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`,
        { headers: { cookie } },
      )) as Response
    ).status,
  ).toBe(200);
  expect(
    (
      (await check(
        "/api/auth/device/deny",
        json({ userCode: code.user_code }, { origin, cookie }),
      )) as Response
    ).status,
  ).toBe(200);
  const result = (await check(
    "/api/auth/device/token",
    json({
      client_id: "raphie-native",
      device_code: code.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  )) as Response;
  expect(result.ok).toBe(false);
  expect(((await result.json()) as { error?: string }).error).toBe(
    "access_denied",
  );
  const devices = (await check("/api/auth/authorized-devices", {
    headers: { cookie },
  })) as Response;
  expect(await devices.json()).toEqual([]);
});

test("device codes expire and polling is rate limited", async () => {
  const { check, json, cookie, directory } = await fixture();
  const issued = (await check(
    "/api/auth/device/code",
    json({ client_id: "raphie-native" }),
  )) as Response;
  const code = (await issued.json()) as {
    user_code: string;
    device_code: string;
  };
  const tokenBody = {
    client_id: "raphie-native",
    device_code: code.device_code,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  };
  const pending = (await check(
    "/api/auth/device/token",
    json(tokenBody),
  )) as Response;
  expect(((await pending.json()) as { error: string }).error).toBe(
    "authorization_pending",
  );
  const fast = (await check(
    "/api/auth/device/token",
    json(tokenBody),
  )) as Response;
  expect(((await fast.json()) as { error: string }).error).toBe("slow_down");
  const database = new Database(join(directory, "auth.sqlite"));
  database.query('UPDATE "deviceCode" SET "expiresAt" = 0').run();
  database.close();
  const expired = (await check(
    `/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`,
    { headers: { cookie } },
  )) as Response;
  expect(expired.ok).toBe(false);
});

test("administrator recovery revokes device sessions as well as browsers", async () => {
  const { check, json, cookie, admin, directory } = await fixture();
  const issued = (await check(
    "/api/auth/device/code",
    json({ client_id: "raphie-native" }),
  )) as Response;
  const code = (await issued.json()) as {
    user_code: string;
    device_code: string;
  };
  await check(
    `/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`,
    { headers: { cookie } },
  );
  await check(
    "/api/auth/device/approve",
    json({ userCode: code.user_code }, { origin, cookie }),
  );
  const redeemed = (await check(
    "/api/auth/device/token",
    json({
      client_id: "raphie-native",
      device_code: code.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  )) as Response;
  const { access_token } = (await redeemed.json()) as { access_token: string };
  const another = (await check(
    "/api/auth/device/code",
    json({ client_id: "raphie-native" }),
  )) as Response;
  const pending = (await another.json()) as {
    user_code: string;
    device_code: string;
  };
  await check(
    `/api/auth/device?user_code=${encodeURIComponent(pending.user_code)}`,
    { headers: { cookie } },
  );
  await check(
    "/api/auth/device/approve",
    json({ userCode: pending.user_code }, { origin, cookie }),
  );
  await admin.recover("another long test password");
  const late = (await check(
    "/api/auth/device/token",
    json({
      client_id: "raphie-native",
      device_code: pending.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  )) as Response;
  expect(late.ok).toBe(false);
  expect(
    (
      (await check("/api/runtime", {
        headers: { authorization: `Bearer ${access_token}` },
      })) as Response
    ).status,
  ).toBe(401);
  expect(
    (
      (await check("/api/auth/authorized-devices", {
        headers: { cookie },
      })) as Response
    ).status,
  ).toBe(401);
  const database = new Database(join(directory, "auth.sqlite"));
  expect(
    database.query("SELECT COUNT(*) AS count FROM raphie_device_session").get(),
  ).toEqual({ count: 0 });
  database.close();
});

test("a failed device registration revokes the new session before returning an error", async () => {
  const { check, json, cookie, directory } = await fixture();
  const issued = (await check(
    "/api/auth/device/code",
    json({ client_id: "raphie-native" }),
  )) as Response;
  const code = (await issued.json()) as {
    user_code: string;
    device_code: string;
  };
  await check(
    `/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`,
    { headers: { cookie } },
  );
  await check(
    "/api/auth/device/approve",
    json({ userCode: code.user_code }, { origin, cookie }),
  );
  const database = new Database(join(directory, "auth.sqlite"));
  database.run("DROP TABLE raphie_device_session");
  const redemption = (await check(
    "/api/auth/device/token",
    json({
      client_id: "raphie-native",
      device_code: code.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  )) as Response;
  expect(redemption.status).toBe(503);
  expect(await redemption.text()).not.toContain("access_token");
  expect(
    database.query('SELECT COUNT(*) AS count FROM "session"').get(),
  ).toEqual({ count: 1 });
  database.close();
});

test("a device redemption racing password recovery cannot survive it", async () => {
  const { check, json, cookie, admin } = await fixture();
  const issued = (await check(
    "/api/auth/device/code",
    json({ client_id: "raphie-native" }),
  )) as Response;
  const code = (await issued.json()) as {
    user_code: string;
    device_code: string;
  };
  await check(
    `/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`,
    { headers: { cookie } },
  );
  await check(
    "/api/auth/device/approve",
    json({ userCode: code.user_code }, { origin, cookie }),
  );
  const [response] = await Promise.all([
    check(
      "/api/auth/device/token",
      json({
        client_id: "raphie-native",
        device_code: code.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    ) as Promise<Response>,
    admin.recover("another long test password"),
  ]);
  if (response.ok) {
    const { access_token } = (await response.json()) as {
      access_token: string;
    };
    expect(
      (
        (await check("/api/runtime", {
          headers: { authorization: `Bearer ${access_token}` },
        })) as Response
      ).status,
    ).toBe(401);
  } else expect(response.status).toBeGreaterThanOrEqual(400);
});

test("replacing the authentication secret invalidates devices and outstanding codes", async () => {
  const { check, json, cookie, directory } = await fixture();
  const issue = async () => {
    const response = (await check(
      "/api/auth/device/code",
      json({ client_id: "raphie-native" }),
    )) as Response;
    return (await response.json()) as {
      user_code: string;
      device_code: string;
    };
  };
  const code = await issue();
  await check(
    `/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`,
    { headers: { cookie } },
  );
  await check(
    "/api/auth/device/approve",
    json({ userCode: code.user_code }, { origin, cookie }),
  );
  const redeemed = (await check(
    "/api/auth/device/token",
    json({
      client_id: "raphie-native",
      device_code: code.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  )) as Response;
  const { access_token } = (await redeemed.json()) as { access_token: string };
  const pending = await issue();
  await check(
    `/api/auth/device?user_code=${encodeURIComponent(pending.user_code)}`,
    { headers: { cookie } },
  );
  await check(
    "/api/auth/device/approve",
    json({ userCode: pending.user_code }, { origin, cookie }),
  );
  await unlink(join(directory, "auth.secret"));
  const restarted = await openAuthService({
    directory,
    origins: [origin],
    role: "server",
  });
  opened.push(restarted);
  const next = createGateway({ service: restarted, origins: [origin] });
  expect(
    (
      (await check("/api/runtime", {
        headers: { authorization: `Bearer ${access_token}` },
      })) as Response
    ).status,
  ).toBe(401);
  expect(
    (
      (await next.check(
        new Request(origin + "/api/runtime", {
          headers: { authorization: `Bearer ${access_token}` },
        }),
      )) as Response
    ).status,
  ).toBe(401);
  expect(
    (
      (await next.check(
        new Request(
          origin + "/api/auth/device/token",
          json({
            client_id: "raphie-native",
            device_code: pending.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        ),
      )) as Response
    ).ok,
  ).toBe(false);
});

test("the real web host gates device enrollment and native API access", async () => {
  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const port = probe.port!;
  await probe.stop(true);
  const host = `http://127.0.0.1:${port}`;
  const directory = await mkdtemp(join(tmpdir(), "raphie-device-http-"));
  directories.push(directory);
  const admin = await openAuthService({
    directory,
    origins: [host],
    role: "admin",
  });
  const service = await openAuthService({
    directory,
    origins: [host],
    role: "server",
  });
  opened.push(admin, service);
  await admin.setup("admin@example.test", "a long test password");
  const web = startWebServer({
    gateway: createGateway({ service, origins: [host] }),
    clientDirectory: directory,
    port,
    fetch: () => new Response("runtime-ok"),
  });
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(host + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  try {
    const redirect = await fetch(`${host}/device?user_code=ABCD2345`, {
      headers: { accept: "text/html" },
      redirect: "manual",
    });
    expect(redirect.status).toBe(303);
    expect(redirect.headers.get("location")).toContain(
      "%2Fdevice%3Fuser_code%3DABCD2345",
    );
    const login = await post(
      "/api/auth/sign-in/email",
      { email: "admin@example.test", password: "a long test password" },
      { origin: host },
    );
    const cookie = login.headers.getSetCookie()[0]!.split(";")[0]!;
    const issue = await post("/api/auth/device/code", {
      client_id: "raphie-native",
    });
    expect(issue.status).toBe(200);
    const code = (await issue.json()) as {
      user_code: string;
      device_code: string;
    };
    expect(
      (
        await fetch(
          `${host}/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`,
          { headers: { cookie } },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await post(
          "/api/auth/device/approve",
          { userCode: code.user_code },
          { origin: host, cookie },
        )
      ).status,
    ).toBe(200);
    const redemption = await post("/api/auth/device/token", {
      client_id: "raphie-native",
      device_code: code.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    expect(redemption.status).toBe(200);
    expect(redemption.headers.has("set-cookie")).toBe(false);
    const token = ((await redemption.json()) as { access_token: string })
      .access_token;
    const native = await fetch(`${host}/api/runtime`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await native.text()).toBe("runtime-ok");
    expect(native.headers.has("set-cookie")).toBe(false);
    expect(
      (
        await post(
          "/api/runtime",
          {},
          { origin: "https://evil.example", authorization: `Bearer ${token}` },
        )
      ).status,
    ).toBe(403);
  } finally {
    await web.stop(true);
  }
});

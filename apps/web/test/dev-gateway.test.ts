import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer } from "vite";

import { developmentGateway } from "../src/bootstrap/dev-gateway.ts";
import { openAuthService } from "../src/infrastructure/auth/auth-service.ts";

const origin = "http://127.0.0.1:4320";
const password = "a long test password";

test("the development server is gated like production, including cookie-setting sign-in", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-dev-gateway-"));
  const saved = { ...process.env };
  process.env.DATA_DIRECTORY = directory;
  process.env.RAPHIE_WEB_ORIGIN = origin;
  const admin = await openAuthService({
    directory,
    origins: [origin],
    role: "admin",
  });
  await admin.setup("admin@example.test", password);
  admin.close();
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, hmr: false },
    plugins: [
      developmentGateway(),
      {
        name: "stub-application",
        configureServer: (vite) => () =>
          vite.middlewares.use((_request, response) => response.end("app")),
      },
    ],
  });
  try {
    await server.listen();
    const port = server.config.server.port!;
    const send = (
      method: string,
      path: string,
      headers: Record<string, string> = {},
      body?: string,
    ) =>
      new Promise<{ status: number; headers: Headers; text: string }>(
        (resolve, reject) => {
          const outgoing = request(
            { host: "127.0.0.1", port, method, path, headers },
            (response) => {
              let text = "";
              response.on("data", (chunk) => (text += chunk));
              response.on("end", () =>
                resolve({
                  status: response.statusCode!,
                  headers: new Headers(
                    Object.entries(response.headers).flatMap(([k, v]) =>
                      [v].flat().map((value) => [k, String(value)] as const),
                    ),
                  ),
                  text,
                }),
              );
            },
          );
          outgoing.on("error", reject);
          outgoing.end(body);
        },
      );
    const base = { host: "127.0.0.1:4320", accept: "text/html" };
    const json = {
      ...base,
      origin,
      "content-type": "application/json",
    };

    const denied = await send("GET", "/", base);
    expect(denied.status).toBe(303);
    expect(denied.headers.get("location")).toBe("/login?next=%2F");
    expect((await send("GET", "/api/bots", { host: base.host })).status).toBe(
      401,
    );
    expect(
      (
        await send(
          "POST",
          "/api/auth/sign-in/email",
          { ...json, origin: "http://evil.example" },
          JSON.stringify({ email: "admin@example.test", password }),
        )
      ).status,
    ).toBe(403);

    const signedIn = await send(
      "POST",
      "/api/auth/sign-in/email",
      json,
      JSON.stringify({ email: "admin@example.test", password }),
    );
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers.get("set-cookie")!.split(";")[0]!;
    expect((await send("GET", "/", { ...base, cookie })).text).toBe("app");

    const out = await send(
      "POST",
      "/api/auth/sign-out",
      { ...json, cookie },
      "{}",
    );
    expect(out.status).toBe(200);
    expect((await send("GET", "/", { ...base, cookie })).status).toBe(303);
  } finally {
    await server.close();
    process.env = saved;
    await rm(directory, { recursive: true, force: true });
  }
});

import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BotMcp } from "../src/domains/settings/infrastructure/bot-mcp.ts";
import { connectMcp } from "../src/infrastructure/mcp/client.ts";
import { McpOAuth } from "../src/infrastructure/mcp/oauth.ts";
import { ModelConnectionGate } from "../src/shared/infrastructure/model-connection-gate.ts";
import { memoryCredentialKeyStore } from "./credential-store.ts";
import { rpcResponse } from "./mcp-fixture.ts";

function oauthFixture() {
  let issued = false;
  let exchanges = 0;
  let challenge = "";
  let refreshes = 0;
  let expired = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const origin = url.origin;
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
        return Response.json({
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
        });
      if (url.pathname === "/.well-known/oauth-authorization-server")
        return Response.json({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
      if (url.pathname === "/register") {
        const metadata = await request.json();
        return Response.json(
          { ...metadata, client_id: "raphie-test" },
          { status: 201 },
        );
      }
      if (url.pathname === "/token") {
        const input = new URLSearchParams(await request.text());
        if (input.get("grant_type") === "refresh_token") {
          expect(input.get("refresh_token")).toBe("synthetic-oauth-refresh");
          refreshes++;
          expired = false;
          return Response.json({
            access_token: "synthetic-oauth-access",
            refresh_token: "synthetic-oauth-refresh",
            token_type: "Bearer",
          });
        }
        expect(input.get("code")).toBe("synthetic-code");
        expect(input.get("grant_type")).toBe("authorization_code");
        expect(
          new Bun.CryptoHasher("sha256")
            .update(input.get("code_verifier")!)
            .digest("base64url"),
        ).toBe(challenge);
        exchanges++;
        issued = true;
        return Response.json({
          access_token: "synthetic-oauth-access",
          refresh_token: "synthetic-oauth-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (
        !issued ||
        expired ||
        request.headers.get("authorization") !== "Bearer synthetic-oauth-access"
      )
        return new Response(null, {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
          },
        });
      if (request.method === "DELETE")
        return new Response(null, { status: 204 });
      if (request.method === "GET") return new Response(null, { status: 405 });
      const result = rpcResponse(await request.json());
      return result
        ? Response.json(result)
        : new Response(null, { status: 202 });
    },
  });
  return {
    server,
    challenge: (value: string) => {
      challenge = value;
    },
    exchanges: () => exchanges,
    refreshes: () => refreshes,
    expire: () => {
      expired = true;
    },
  };
}

test("OAuth refuses grants to nonlocal plaintext MCP endpoints", async () => {
  let saved = false;
  const failure = await McpOAuth.open(
    "http://tools.example.com/mcp",
    undefined,
    () => {
      saved = true;
    },
    async () => {},
  ).catch((error: unknown) => error);
  expect(String(failure)).toContain("OAuth requires HTTPS");
  expect(saved).toBe(false);
});

test("MCP browser OAuth uses PKCE, encrypted tokens, refresh and restart recovery", async () => {
  const fixture = oauthFixture();
  const { server } = fixture;
  const directory = await mkdtemp(join(tmpdir(), "raphie-oauth-"));
  const path = join(directory, "mcp.sqlite");
  const options = {
    gate: new ModelConnectionGate(),
    busy: async () => false,
    keyStore: memoryCredentialKeyStore(),
    publish: () => {},
  };
  let service = await BotMcp.open(path, options);
  try {
    const [pending] = await service.add({
      name: "Browser tools",
      transport: "http",
      url: `http://127.0.0.1:${server.port}/mcp`,
    });
    expect(pending.connected).toBe(false);
    expect(pending.authorizationUrl).toBeDefined();
    const consent = new URL(pending.authorizationUrl!);
    fixture.challenge(consent.searchParams.get("code_challenge")!);
    expect(consent.searchParams.get("code_challenge_method")).toBe("S256");
    await service.change(pending.id, "enable");
    expect(service.read()[0].authorizationUrl).toBe(consent.href);
    const callback = new URL(consent.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", "synthetic-code");
    callback.searchParams.set("state", "wrong-state");
    expect((await fetch(callback)).status).toBe(400);
    expect(fixture.exchanges()).toBe(0);
    callback.searchParams.set("state", consent.searchParams.get("state")!);
    expect((await fetch(callback)).ok).toBe(true);
    for (let i = 0; i < 100 && !service.read()[0].connected; i++)
      await Bun.sleep(10);
    expect(service.read()[0].connected).toBe(true);
    expect(service.read()[0].toolCount).toBe(2);
    expect(fixture.exchanges()).toBe(1);
    expect(JSON.stringify(service.read())).not.toContain(
      "synthetic-oauth-access",
    );
    const disk = await readFile(path);
    for (const secret of ["synthetic-oauth-access", "synthetic-oauth-refresh"])
      expect(disk.includes(Buffer.from(secret))).toBe(false);
    await service.close();
    fixture.expire();
    service = await BotMcp.open(path, options);
    expect(fixture.refreshes()).toBe(1);
    expect(service.read()[0].connected).toBe(true);
    expect(service.read()[0].authorizationUrl).toBeUndefined();
    expect(fixture.exchanges()).toBe(1);
  } finally {
    await service.close();
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

for (const action of [
  "deny",
  "issuer",
  "disable",
  "remove",
  "restart",
] as const) {
  test(`MCP OAuth ${action} retires the callback and keeps bot grants separate`, async () => {
    const { server } = oauthFixture();
    const directory = await mkdtemp(join(tmpdir(), "raphie-oauth-cancel-"));
    const options = {
      gate: new ModelConnectionGate(),
      busy: async () => false,
      keyStore: memoryCredentialKeyStore(),
      publish: () => {},
    };
    const path = join(directory, "a.sqlite");
    let a = await BotMcp.open(path, options);
    const b = await BotMcp.open(join(directory, "b.sqlite"), {
      ...options,
      gate: new ModelConnectionGate(),
    });
    try {
      const input = {
        name: "Private",
        transport: "http" as const,
        url: `http://127.0.0.1:${server.port}/mcp`,
      };
      const [entry] = await a.add(input);
      const [other] = await b.add(input);
      const consent = new URL(entry.authorizationUrl!);
      const callback = new URL(consent.searchParams.get("redirect_uri")!);
      callback.searchParams.set(
        "state",
        new URL(other.authorizationUrl!).searchParams.get("state")!,
      );
      callback.searchParams.set("code", "synthetic-code");
      expect((await fetch(callback)).status).toBe(400);
      if (action === "deny" || action === "issuer") {
        callback.searchParams.set("state", consent.searchParams.get("state")!);
        if (action === "deny")
          callback.searchParams.set("error", "access_denied");
        else callback.searchParams.set("iss", "https://wrong-issuer.example");
        callback.searchParams.set(
          "error_description",
          "<script>secret-provider-payload</script>",
        );
        const page = await (await fetch(callback)).text();
        expect(page).not.toContain("secret-provider-payload");
        for (let i = 0; i < 100 && !a.read()[0].authorizationFailed; i++)
          await Bun.sleep(10);
        expect(a.read()[0].authorizationFailed).toBe(true);
        await a.change(entry.id, "enable");
        const retry = new URL(a.read()[0].authorizationUrl!);
        expect(retry.searchParams.get("state")).not.toBe(
          consent.searchParams.get("state"),
        );
      } else if (action === "restart") {
        await a.close();
        a = await BotMcp.open(path, options);
        expect(
          new URL(a.read()[0].authorizationUrl!).searchParams.get("state"),
        ).not.toBe(consent.searchParams.get("state"));
      } else {
        await a.change(entry.id, action);
        expect(a.read().some((item) => item.authorizationUrl)).toBe(false);
        expect(a.read().every((item) => !item.connected)).toBe(true);
      }
      expect(b.read()[0].authorizationUrl).toBe(other.authorizationUrl);
      expect(b.read()[0].connected).toBe(false);
    } finally {
      await a.close();
      await b.close();
      await server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("OAuth consent expires without publishing tools and closes its loopback listener", async () => {
  const { server } = oauthFixture();
  const serverUrl = `http://127.0.0.1:${server.port}/mcp`;
  let admitted = false;
  const oauth = await McpOAuth.open(
    serverUrl,
    undefined,
    () => {},
    async () => {
      admitted = true;
    },
    { timeoutMs: 30 },
  );
  try {
    const failure = await connectMcp(
      { transport: "http", url: serverUrl },
      oauth.authProvider,
    ).catch((error: unknown) => error);
    expect(String(failure)).toContain("requires user interaction");
    const callback = new URL(
      new URL(oauth.authorizationUrl!).searchParams.get("redirect_uri")!,
    );
    for (let i = 0; i < 100 && oauth.authorizationUrl; i++) await Bun.sleep(10);
    expect(oauth.failed).toBe(true);
    expect(oauth.authorizationUrl).toBeUndefined();
    expect(admitted).toBe(false);
    const closed = await fetch(callback).then(
      () => false,
      () => true,
    );
    expect(closed).toBe(true);
  } finally {
    await oauth.close();
    await server.stop(true);
  }
});

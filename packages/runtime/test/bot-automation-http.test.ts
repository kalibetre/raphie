import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { BotHost } from "../src/bootstrap/bot-host.ts";
import { startServer } from "../src/bootstrap/http-server.ts";
import { chatModel } from "./chat-model.ts";
import { memoryCredentialKeyStore } from "./credential-store.ts";
import { rpcResponse } from "./mcp-fixture.ts";

test("owner APIs isolate MCP inventories and scheduled prompt results between bots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-automation-http-"));
  const offered: string[][] = [];
  const original = await Gateway.open({
    deferResume: true,
    directory,
    ...chatModel({ offeredTools: (names) => offered.push(names) }),
  });
  const host = await BotHost.open(
    directory,
    { gateway: original },
    async (botId, path) => {
      const gateway = await Gateway.open({
        deferResume: true,
        botId,
        directory: path,
        ...chatModel(),
      });
      return { gateway, close: () => gateway.close() };
    },
    { keyStore: memoryCredentialKeyStore() },
  );
  const server = await startServer(original, { bots: host, port: 0 });
  const mcp = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method === "GET") return new Response(null, { status: 405 });
      if (request.method === "DELETE")
        return new Response(null, { status: 204 });
      const result = rpcResponse(await request.json());
      return result
        ? Response.json(result)
        : new Response(null, { status: 202 });
    },
  });
  const post = (path: string, body: unknown) =>
    fetch(server.url + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-raphie-client": "web",
        origin: server.url,
      },
      body: JSON.stringify(body),
    });
  try {
    const other = await host.create({
      name: "Other",
      description: "Independent",
      soul: "Be precise.",
    });
    const connected = await post("/api/mcp", {
      name: "Tools",
      transport: "http",
      url: `http://127.0.0.1:${mcp.port}/mcp`,
      token: "synthetic-automation-secret",
    });
    expect(connected.status).toBe(201);
    const connection = (await connected.json()).items[0];
    expect(connection.toolCount).toBe(2);
    expect(JSON.stringify(connection)).not.toContain(
      "synthetic-automation-secret",
    );
    expect(
      await fetch(`${server.url}/api/bots/${other.id}/mcp`).then((r) =>
        r.json(),
      ),
    ).toEqual({ items: [] });
    expect(
      (
        await post(`/api/bots/${other.id}/mcp/${connection.id}`, {
          action: "remove",
        })
      ).status,
    ).toBe(404);
    expect(original.mcpConnections).toHaveLength(1);
    expect(host.runtime(other.id).gateway.mcpConnections).toHaveLength(0);
    const added = await post("/api/jobs", {
      name: "Brief",
      prompt: "Give me a brief",
      everyMinutes: 60,
      firstRunAt: Date.now() + 86400_000,
    });
    expect(added.status).toBe(201);
    const job = (await added.json()).items[0];
    expect(
      (await post(`/api/bots/${other.id}/jobs/${job.id}`, { action: "run" }))
        .status,
    ).toBe(404);
    expect((await post(`/api/jobs/${job.id}`, { action: "run" })).status).toBe(
      200,
    );
    for (
      let n = 0;
      n < 200 &&
      !(await original.chats.state()).turns.some((t) => t.status === "done");
      n++
    )
      await delay(10);
    expect((await original.chats.state()).turns).toHaveLength(1);
    expect(offered[0]).toContain("tool_search");
    expect(
      (await host.runtime(other.id).gateway.chats.state()).turns,
    ).toHaveLength(0);
    expect(
      await fetch(`${server.url}/api/bots/${other.id}/jobs`).then((r) =>
        r.json(),
      ),
    ).toEqual({ items: [] });
  } finally {
    await server.close();
    await host.close();
    await original.close();
    await mcp.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

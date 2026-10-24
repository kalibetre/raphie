import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { BotHost } from "../src/bootstrap/bot-host.ts";
import { startServer } from "../src/bootstrap/http-server.ts";

test("workspace browsing and downloads expose only the selected bot's committed virtual files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-workspace-http-"));
  const gateway = await Gateway.open({ directory, deferResume: true });
  const host = await BotHost.open(
    directory,
    { gateway },
    async (botId, path) => {
      const bot = await Gateway.open({
        directory: path,
        botId,
        deferResume: true,
      });
      return { gateway: bot, close: () => bot.close() };
    },
  );
  const server = await startServer(gateway, { port: 0, bots: host });
  const get = (path: string) => fetch(server.url + path);
  const files = (path = "/workspace") =>
    get(`/api/workspace/files?path=${encodeURIComponent(path)}`);
  const download = (path: string, revision: number) =>
    get(
      `/api/workspace/download?path=${encodeURIComponent(path)}&revision=${revision}`,
    );
  try {
    const info = await get("/api/workspace").then((r) => r.json());
    expect(info.provider).toEqual({
      id: "just-bash",
      name: "just-bash",
      version: "3.6.0",
    });
    expect(info.capabilities).toEqual({
      network: false,
      nativeCode: false,
      hostFiles: false,
    });
    expect(info.limits.fileBytes).toBe(8388608);
    expect((await files().then((r) => r.json())).items).toEqual([]);
    await gateway.workspace.execute(
      "session",
      "seed",
      "mkdir reports; echo private > reports/note.txt; echo AP8= | base64 -d > binary; ln -s reports/note.txt link; ln -s reports linked-folder; printf '<script>alert(1)</script>' > 'report 中文.html'",
    );
    const root = await files().then((r) => r.json());
    expect(root.items[0].kind).toBe("directory");
    expect(root.items.map((e: { name: string }) => e.name).sort()).toEqual(
      ["binary", "link", "linked-folder", "report 中文.html", "reports"].sort(),
    );
    expect(JSON.stringify(root)).not.toContain("private");
    const folder = await files("/workspace/reports").then((r) => r.json());
    expect(folder.items[0]).toMatchObject({
      name: "note.txt",
      bytes: 8,
      kind: "file",
    });
    const binary = await download("/workspace/binary", root.revision);
    expect(binary.status).toBe(200);
    expect([...new Uint8Array(await binary.arrayBuffer())]).toEqual([0, 255]);
    const html = await download("/workspace/report 中文.html", root.revision);
    expect(html.headers.get("content-type")).toBe("application/octet-stream");
    expect(html.headers.get("content-disposition")).toContain(
      "attachment; filename*=UTF-8''report%20",
    );
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
    for (const path of [
      "/etc/passwd",
      "/workspace/../settings.sqlite",
      "/workspace/reports/../../gateway.sqlite",
      "/workspace//binary",
      "/workspace/./binary",
      "/workspace/binary\0",
    ]) {
      expect((await files(path)).status).toBe(400);
      expect((await download(path, root.revision)).status).toBe(400);
    }
    expect((await files("/workspace/linked-folder")).status).toBe(404);
    expect((await download("/workspace/link", root.revision)).status).toBe(400);
    expect((await download("/workspace/reports", root.revision)).status).toBe(
      400,
    );
    expect((await download("/workspace/unknown", root.revision)).status).toBe(
      404,
    );
    expect(
      (await get("/api/workspace/download?path=/workspace/binary")).status,
    ).toBe(400);
    expect(
      (
        await fetch(server.url + "/api/workspace", {
          headers: { origin: "https://foreign.example" },
        })
      ).status,
    ).toBe(403);
    const other = await host.create({
      name: "Other",
      description: "",
      soul: "",
    });
    const otherBase = `/api/bots/${other.id}/workspace`;
    expect(
      (await get(otherBase + "/files").then((r) => r.json())).items,
    ).toEqual([]);
    await host
      .runtime(other.id)
      .gateway.workspace.execute("other", "seed", "echo other > binary");
    const otherRoot = await get(otherBase + "/files").then((r) => r.json());
    expect(
      await get(
        `${otherBase}/download?path=/workspace/binary&revision=${otherRoot.revision}`,
      ).then((r) => r.text()),
    ).toBe("other\n");
    expect(
      (
        await get(
          `${otherBase}/download?path=/workspace/reports/note.txt&revision=${otherRoot.revision}`,
        )
      ).status,
    ).toBe(404);
    const pending = gateway.workspace.execute(
      "session",
      "slow",
      "echo uncommitted > reports/note.txt; sleep 0.3",
    );
    expect(
      await download("/workspace/reports/note.txt", root.revision).then((r) =>
        r.text(),
      ),
    ).toBe("private\n");
    await pending;
    expect(
      (await download("/workspace/reports/note.txt", root.revision)).status,
    ).toBe(409);
    const refreshed = await files("/workspace/reports").then((r) => r.json());
    expect(
      await download("/workspace/reports/note.txt", refreshed.revision).then(
        (r) => r.text(),
      ),
    ).toBe("uncommitted\n");
  } finally {
    await server.close();
    await host.close();
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

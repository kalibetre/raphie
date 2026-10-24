import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { BotMcpConnection, SaveMcpConnection } from "@raphie/contracts";

import {
  connectMcp,
  type McpClient,
  type McpConnection,
} from "../../../infrastructure/mcp/client.ts";
import { InputError } from "../../../shared/application/input-error.ts";
import type { ModelConnectionGate } from "../../../shared/infrastructure/model-connection-gate.ts";
import { registerRedactionSecret } from "../../activity/infrastructure/pi-activity-journal.ts";
import type { McpTools } from "../../approvals/infrastructure/mcp-approval-gate.ts";
import {
  CredentialCipher,
  type CredentialKeyStore,
  osCredentialKeyStore,
} from "./credential-cipher.ts";

type Entry = {
  id: string;
  name: string;
  enabled: boolean;
  config: McpConnection;
};

type Options = {
  gate: ModelConnectionGate;
  busy: () => Promise<boolean>;
  publish: (tools: McpTools[]) => void;
  keyStore?: CredentialKeyStore;
  connect?: typeof connectMcp;
};

/** Owner-managed connections; only encrypted transport configuration reaches disk. */
export class BotMcp {
  private db: Database;
  private cipher: CredentialCipher;
  private options: Options;
  private entries: Entry[] = [];
  private clients = new Map<string, McpClient>();

  private constructor(
    db: Database,
    cipher: CredentialCipher,
    options: Options,
  ) {
    this.db = db;
    this.cipher = cipher;
    this.options = options;
  }

  static async open(path: string, options: Options) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const db = new Database(path, { strict: true });
    let service: BotMcp | undefined;
    try {
      await chmod(path, 0o600);
      db.exec(
        "PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS mcp (id INTEGER PRIMARY KEY CHECK(id=1), key_id TEXT NOT NULL, value TEXT NOT NULL)",
      );
      const row = db
        .query<{ key_id: string; value: string }, []>(
          "SELECT key_id,value FROM mcp WHERE id=1",
        )
        .get();
      const cipher = await CredentialCipher.open(
        options.keyStore ?? osCredentialKeyStore,
        row?.key_id,
      );
      service = new BotMcp(db, cipher, options);
      if (row)
        service.entries = JSON.parse(
          cipher.decrypt(JSON.parse(row.value), "connections", "mcp")!,
        );
      else service.persist();
      for (const entry of service.entries) {
        service.redact(entry.config);
        if (entry.enabled) {
          try {
            service.clients.set(entry.id, await service.connect(entry.config));
          } catch {
            /* An unavailable server must not stop the bot. */
          }
        }
      }
      service.publish();
      return service;
    } catch (error) {
      if (service) await service.close();
      else db.close();
      throw error;
    }
  }

  read(): BotMcpConnection[] {
    return this.entries.map((e) => ({
      id: e.id,
      name: e.name,
      enabled: e.enabled,
      transport: e.config.transport,
      address:
        e.config.transport === "stdio"
          ? e.config.command
          : new URL(e.config.url).origin,
      connected: this.clients.has(e.id),
      toolCount: this.clients.get(e.id)?.tools.length ?? 0,
      credentialConfigured:
        e.config.transport === "stdio"
          ? !!Object.keys(e.config.env ?? {}).length
          : !!e.config.token,
    }));
  }

  private redact(config: McpConnection) {
    const secrets =
      config.transport === "stdio"
        ? Object.values(config.env ?? {})
        : [config.token ?? ""];
    for (const secret of secrets) if (secret) registerRedactionSecret(secret);
  }

  private async connect(config: McpConnection) {
    const client = await (this.options.connect ?? connectMcp)(config);
    const names = client.tools.map((t) =>
      t.name.replace(/[^a-zA-Z0-9_]/g, "_"),
    );
    if (new Set(names).size !== names.length) {
      await client.close();
      throw new Error("Ambiguous tool names.");
    }
    return client;
  }

  private publish() {
    this.options.publish(
      this.entries.flatMap((e) => {
        const client = this.clients.get(e.id);
        return client
          ? [
              {
                client,
                namespace: `c_${e.id.replaceAll("-", "")}`,
                identity: new Bun.CryptoHasher("sha256")
                  .update(JSON.stringify(e.config))
                  .digest("hex"),
              },
            ]
          : [];
      }),
    );
  }

  private persist() {
    this.db
      .query("INSERT OR REPLACE INTO mcp(id,key_id,value) VALUES(1,?,?)")
      .run(
        this.cipher.keyId,
        JSON.stringify(
          this.cipher.encrypt(
            JSON.stringify(this.entries),
            "connections",
            "mcp",
          ),
        ),
      );
  }

  private async idle() {
    if (await this.options.busy())
      throw new InputError(
        "Wait for this bot's active turns and approvals to finish before changing MCP.",
        409,
      );
  }

  async add(input: SaveMcpConnection) {
    return this.options.gate.run(async () => {
      await this.idle();
      if (this.entries.length >= 16)
        throw new InputError("A bot can have at most 16 MCP connections.");
      const config: McpConnection =
        input.transport === "stdio"
          ? {
              transport: "stdio",
              command: input.command!,
              args: input.args,
              env: input.env,
            }
          : { transport: input.transport, url: input.url!, token: input.token };
      this.redact(config);
      let client: McpClient;
      try {
        client = await this.connect(config);
      } catch {
        throw new InputError(
          "MCP connection failed. Check the address, credentials and server, then retry.",
          400,
        );
      }
      const entry = {
        id: crypto.randomUUID(),
        name: input.name,
        enabled: true,
        config,
      };
      this.entries.push(entry);
      this.clients.set(entry.id, client);
      this.persist();
      this.publish();
      return this.read();
    });
  }

  async change(id: string, action: "enable" | "disable" | "remove") {
    return this.options.gate.run(async () => {
      await this.idle();
      const entry = this.entries.find((e) => e.id === id);
      if (!entry) throw new InputError("MCP connection not found.", 404);
      if (action === "enable" && !this.clients.has(id)) {
        try {
          this.clients.set(id, await this.connect(entry.config));
        } catch {
          throw new InputError(
            "MCP connection failed. Check the server and retry.",
          );
        }
      }
      entry.enabled = action === "enable";
      const old = action === "enable" ? undefined : this.clients.get(id);
      if (action !== "enable") this.clients.delete(id);
      if (action === "remove")
        this.entries = this.entries.filter((e) => e.id !== id);
      this.persist();
      this.publish();
      await old?.close().catch(() => {});
      return this.read();
    });
  }

  async close() {
    await Promise.allSettled([...this.clients.values()].map((c) => c.close()));
    this.clients.clear();
    this.cipher.close();
    this.db.close();
  }
}

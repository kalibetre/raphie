import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { McpOAuthAuthorizationRequiredError } from "@earendil-works/pi-mcp/oauth";
import type { BotMcpConnection, SaveMcpConnection } from "@raphie/contracts";

import {
  connectMcp,
  type McpClient,
  type McpConnection,
} from "../../../infrastructure/mcp/client.ts";
import {
  McpOAuth,
  type SavedMcpOAuth,
} from "../../../infrastructure/mcp/oauth.ts";
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
  legacy?: boolean;
  oauth?: SavedMcpOAuth;
};

type Options = {
  legacy?: McpConnection;
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
  private environmentEntry = false;
  private clients = new Map<string, McpClient>();
  private oauth = new Map<string, McpOAuth>();
  private closed = false;

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
      db.exec(
        "CREATE TABLE IF NOT EXISTS legacy_mcp (id INTEGER PRIMARY KEY CHECK(id=1))",
      );
      if (options.legacy && !db.query("SELECT id FROM legacy_mcp").get()) {
        service.environmentEntry = true;
        service.entries.push({
          id: "legacy-environment",
          name: "Legacy environment MCP",
          enabled: true,
          config: options.legacy,
          legacy: true,
        });
      }
      for (const entry of service.entries) {
        service.redact(entry.config);
        if (entry.enabled) {
          try {
            service.clients.set(entry.id, await service.connect(entry));
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
      source: this.environmentEntry && e.legacy ? "environment" : "saved",
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
          : !!e.config.token || !!e.oauth?.state?.tokens,
      authorizationUrl: this.oauth.get(e.id)?.authorizationUrl,
      authorizationFailed: this.oauth.get(e.id)?.failed || undefined,
    }));
  }

  private redact(config: McpConnection) {
    const secrets =
      config.transport === "stdio"
        ? Object.values(config.env ?? {})
        : [config.token ?? ""];
    for (const secret of secrets) if (secret) registerRedactionSecret(secret);
  }

  private async connect(entry: Entry) {
    const config = entry.config;
    let oauth = this.oauth.get(entry.id);
    if (config.transport === "http" && !config.token && !oauth) {
      const address = new URL(config.url);
      // Public HTTP remains usable, but it must never receive an OAuth grant.
      const secure =
        address.protocol === "https:" ||
        (address.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(address.hostname));
      if (secure) {
        oauth = await McpOAuth.open(
          config.url,
          entry.oauth,
          (value) => {
            if (this.closed || !this.entries.includes(entry))
              throw new Error("MCP connection was retired.");
            entry.oauth = value;
            for (const secret of [
              value.state?.tokens?.access_token,
              value.state?.tokens?.refresh_token,
              value.state?.clientInformation?.client_secret,
            ])
              if (secret) registerRedactionSecret(secret);
            this.persist();
          },
          async () =>
            this.options.gate.run(async () => {
              if (
                this.closed ||
                !entry.enabled ||
                !this.entries.includes(entry)
              )
                return;
              await this.idle();
              const client = await this.connect(entry);
              const old = this.clients.get(entry.id);
              this.clients.set(entry.id, client);
              this.publish();
              await old?.close().catch(() => {});
            }),
        );
        this.oauth.set(entry.id, oauth);
      }
    }
    const client = await (this.options.connect ?? connectMcp)(
      config,
      oauth?.authProvider,
    );
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
                namespace: e.legacy
                  ? undefined
                  : `c_${e.id.replaceAll("-", "")}`,
                documentationTools:
                  e.legacy && client.server?.name === "executor"
                    ? ["skills"]
                    : [],
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
            JSON.stringify(
              this.entries.filter((e) => !(this.environmentEntry && e.legacy)),
            ),
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
      const entry: Entry = {
        id: crypto.randomUUID(),
        name: input.name,
        enabled: true,
        config,
      };
      this.entries.push(entry);
      try {
        this.clients.set(entry.id, await this.connect(entry));
      } catch (error) {
        if (
          !(error instanceof McpOAuthAuthorizationRequiredError) ||
          !this.oauth.get(entry.id)?.authorizationUrl
        ) {
          await this.oauth.get(entry.id)?.close();
          this.oauth.delete(entry.id);
          this.entries = this.entries.filter((e) => e !== entry);
          this.persist();
          throw new InputError(
            "MCP connection failed. Check the address, credentials and server, then retry.",
            400,
          );
        }
      }
      this.persist();
      this.publish();
      return this.read();
    });
  }

  async change(id: string, action: "enable" | "disable" | "remove" | "import") {
    return this.options.gate.run(async () => {
      await this.idle();
      const entry = this.entries.find((e) => e.id === id);
      if (!entry) throw new InputError("MCP connection not found.", 404);
      if (action === "import") {
        if (!entry.legacy || !this.environmentEntry)
          throw new InputError(
            "Only environment configuration can be imported.",
          );
        if (this.entries.length > 16)
          throw new InputError("Remove a saved connection before importing.");
        this.environmentEntry = false;
        try {
          this.db.transaction(() => {
            this.persist();
            this.db
              .query("INSERT OR IGNORE INTO legacy_mcp(id) VALUES(1)")
              .run();
          })();
        } catch (error) {
          this.environmentEntry = true;
          throw error;
        }
        return this.read();
      }
      if (entry.legacy && this.environmentEntry && action !== "enable") {
        throw new InputError(
          "Import the environment connection before pausing or removing it, or remove its host environment configuration and restart.",
        );
      }
      if (action === "enable" && !this.clients.has(id)) {
        try {
          this.clients.set(id, await this.connect(entry));
        } catch (error) {
          if (
            !(error instanceof McpOAuthAuthorizationRequiredError) ||
            !this.oauth.get(id)?.authorizationUrl
          )
            throw new InputError(
              "MCP connection failed. Check the server and retry.",
            );
        }
      }
      entry.enabled = action === "enable";
      const old = action === "enable" ? undefined : this.clients.get(id);
      if (action !== "enable") this.clients.delete(id);
      if (action !== "enable") {
        await this.oauth.get(id)?.close();
        this.oauth.delete(id);
      }
      if (action === "remove")
        this.entries = this.entries.filter((e) => e.id !== id);
      this.persist();
      this.publish();
      await old?.close().catch(() => {});
      return this.read();
    });
  }

  async close() {
    this.closed = true;
    await Promise.allSettled(
      [...this.oauth.values()].map((oauth) => oauth.close()),
    );
    this.oauth.clear();
    await Promise.allSettled([...this.clients.values()].map((c) => c.close()));
    this.clients.clear();
    this.cipher.close();
    this.db.close();
  }
}

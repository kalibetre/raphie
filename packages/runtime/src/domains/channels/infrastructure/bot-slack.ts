import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { SaveSlackChannel, SlackChannel } from "@raphie/contracts";

import type { ChannelServices } from "../../../application/channels/ports.ts";
import {
  createSlackBridge,
  resolveSlackIdentity,
  type SlackBridgeConfig,
} from "../../../infrastructure/slack/bridge.ts";
import { InputError } from "../../../shared/application/input-error.ts";
import { registerRedactionSecret } from "../../activity/infrastructure/pi-activity-journal.ts";
import {
  configuredCredentialKeyStore,
  CredentialCipher,
  type CredentialKeyStore,
} from "../../settings/infrastructure/credential-cipher.ts";
import type { ReplyDestination } from "../domain/binding.ts";

type Stored = SlackBridgeConfig & { teamName: string };

type Bridge = ReturnType<typeof createSlackBridge>;

export type SlackAdapters = {
  identity: typeof resolveSlackIdentity;
  create: typeof createSlackBridge;
  /** How long a save waits for Slack to accept the connection. */
  connectTimeoutMs?: number;
};

const conflict =
  "This Slack app is already connected to another bot. Remove it from that bot first.";

/**
 * One Slack app per bot: Slack spreads Socket Mode events across every open
 * connection, so two bots sharing an app would each miss messages.
 */
export class SlackConnections {
  private owners = new Map<string, BotSlack>();

  claim(id: string, bot: BotSlack) {
    const owner = this.owners.get(id);
    if (owner && owner !== bot) return false;
    this.owners.set(id, bot);
    return true;
  }

  conflicts(id: string, bot: BotSlack) {
    const owner = this.owners.get(id);
    return !!owner && owner !== bot;
  }

  release(id: string, bot: BotSlack) {
    if (this.owners.get(id) === bot) this.owners.delete(id);
  }
}

/** Per-bot Slack configuration and lifecycle. The tokens never leave this service. */
export class BotSlack {
  private config: Stored | null = null;
  private bridge?: Bridge;
  private connected = false;
  private timer?: ReturnType<typeof setInterval>;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly db: Database;
  private readonly cipher: CredentialCipher;
  private readonly app: ChannelServices;
  private readonly adapters: SlackAdapters;
  private readonly connections: SlackConnections;

  private constructor(
    db: Database,
    cipher: CredentialCipher,
    app: ChannelServices,
    adapters: SlackAdapters,
    connections: SlackConnections,
  ) {
    this.db = db;
    this.cipher = cipher;
    this.app = app;
    this.adapters = adapters;
    this.connections = connections;
  }

  static async open(
    path: string,
    app: ChannelServices,
    keyStore?: CredentialKeyStore,
    adapters: SlackAdapters = {
      identity: resolveSlackIdentity,
      create: createSlackBridge,
    },
    connections = new SlackConnections(),
  ) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const db = new Database(path, { strict: true });
    let service: BotSlack | undefined;
    try {
      await chmod(path, 0o600);
      db.exec(
        "CREATE TABLE IF NOT EXISTS slack (id INTEGER PRIMARY KEY CHECK(id=1), key_id TEXT NOT NULL, value TEXT NOT NULL)",
      );
      const row = db
        .query<{ key_id: string; value: string }, []>(
          "SELECT key_id,value FROM slack WHERE id=1",
        )
        .get();
      const cipher = await CredentialCipher.open(
        keyStore ?? configuredCredentialKeyStore(),
        row?.key_id,
      );
      service = new BotSlack(db, cipher, app, adapters, connections);
      if (row) {
        const stored = JSON.parse(
          cipher.decrypt(JSON.parse(row.value), "slack", "slack")!,
        ) as Stored;
        service.config = stored;
        registerRedactionSecret(stored.botToken);
        registerRedactionSecret(stored.appToken);
        if (!connections.claim(stored.connectionId, service))
          console.error(
            "Slack app is configured for multiple bots; this bot will not connect.",
          );
        // Connects in the background: an unreachable Slack must not hold up
        // the runtime starting.
        else service.start(stored);
      }
      return service;
    } catch (error) {
      if (service) await service.close();
      else db.close();
      throw error;
    }
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }

  acceptsHome(address: ReplyDestination & { userId: string }) {
    if (
      !this.config ||
      !this.connected ||
      address.provider !== "slack" ||
      address.connectionId !== this.config.connectionId ||
      !this.config.allowedUserIds.includes(address.userId)
    )
      return false;
    return (
      !this.config.channelId ||
      address.conversation.split(":")[1] === this.config.channelId
    );
  }

  read(): { slack: SlackChannel | null } {
    return {
      slack: this.config
        ? {
            allowedUserIds: this.config.allowedUserIds,
            channelId: this.config.channelId ?? "",
            teamName: this.config.teamName,
            connected: this.connected,
            tokenConfigured: true,
            conflict: this.connections.conflicts(
              this.config.connectionId,
              this,
            ),
          }
        : null,
    };
  }

  /**
   * Starts the bridge and opens its Socket Mode connection, which the SDK
   * keeps retrying and reconnects on its own. Returns at once, or with `wait`,
   * once Slack accepts the connection, failing after that many milliseconds.
   */
  private start(config: SlackBridgeConfig): void;
  private start(config: SlackBridgeConfig, wait: number): Promise<void>;
  private start(config: SlackBridgeConfig, wait?: number) {
    const bridge = this.adapters.create(this.app, config);
    this.bridge = bridge;
    this.connected = false;
    this.timer = setInterval(() => {
      if (!this.connected || this.bridge !== bridge) return;
      void bridge
        .flush()
        .catch(() => console.error("Slack delivery pump failed."));
    }, 1000);
    const opening = bridge.connect().then(() => {
      if (this.bridge === bridge) this.connected = true;
    });
    if (wait === undefined) {
      void opening.catch(() =>
        console.error(
          "Slack channel could not connect. Check this bot's channel settings.",
        ),
      );
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      opening,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Slack did not answer.")),
          wait,
        );
      }),
    ]).finally(() => clearTimeout(timer));
  }

  private async stop() {
    if (this.timer) clearInterval(this.timer);
    const bridge = this.bridge;
    this.bridge = undefined;
    this.connected = false;
    this.timer = undefined;
    await bridge?.close();
  }

  save(input: SaveSlackChannel) {
    return this.serialize(() => this.saveLocked(input));
  }

  private async saveLocked(input: SaveSlackChannel) {
    const botToken = input.botToken || this.config?.botToken;
    const appToken = input.appToken || this.config?.appToken;
    if (!botToken) throw new InputError("Enter a Slack bot token.");
    if (!appToken) throw new InputError("Enter a Slack app-level token.");
    registerRedactionSecret(botToken);
    registerRedactionSecret(appToken);
    let identity;
    try {
      identity = await this.adapters.identity(botToken);
    } catch {
      throw new InputError(
        "Slack connection failed. Check the bot token and the app's scopes.",
      );
    }
    if (this.config && this.config.connectionId !== identity.connectionId)
      throw new InputError(
        "Use the same Slack app or remove the existing connection first.",
      );
    const next: Stored = {
      botToken,
      appToken,
      connectionId: identity.connectionId,
      botUserId: identity.botUserId,
      teamName: identity.teamName,
      allowedUserIds: input.allowedUserIds,
      channelId: input.channelId || undefined,
    };
    const previouslyOwned = !!this.config;
    if (!this.connections.claim(next.connectionId, this))
      throw new InputError(conflict, 409);
    try {
      await this.stop();
      await this.start(next, this.adapters.connectTimeoutMs ?? 15_000);
    } catch {
      await this.stop();
      if (this.config) this.start(this.config);
      if (!previouslyOwned) this.connections.release(next.connectionId, this);
      throw new InputError(
        "Slack connection failed. Check the app-level token, that Socket Mode is on, and that Slack is reachable.",
      );
    }
    try {
      this.db
        .query("INSERT OR REPLACE INTO slack(id,key_id,value) VALUES(1,?,?)")
        .run(
          this.cipher.keyId,
          JSON.stringify(
            this.cipher.encrypt(JSON.stringify(next), "slack", "slack"),
          ),
        );
      this.config = next;
    } catch (error) {
      await this.stop();
      if (this.config) this.start(this.config);
      if (!previouslyOwned) this.connections.release(next.connectionId, this);
      throw error;
    }
    return this.read();
  }

  remove() {
    return this.serialize(async () => {
      await this.stop();
      this.db.query("DELETE FROM slack WHERE id=1").run();
      if (this.config) this.connections.release(this.config.connectionId, this);
      this.config = null;
      return this.read();
    });
  }

  close() {
    return this.serialize(async () => {
      await this.stop();
      if (this.config) this.connections.release(this.config.connectionId, this);
      this.cipher.close();
      this.db.close();
    });
  }
}

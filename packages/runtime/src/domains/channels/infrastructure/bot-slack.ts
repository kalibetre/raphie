import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { SaveSlackChannel, SlackChannel } from "@raphie/contracts";

import type { ChannelServices } from "../../../application/channels/ports.ts";
import {
  createSlackBridge,
  resolveSlackIdentity,
  slackAppId,
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

type Stored = Omit<SlackBridgeConfig, "followed" | "onFollow"> & {
  teamName: string;
  /** The Slack app both tokens belong to, when it is known. */
  appId?: string;
};

/** How many followed threads are remembered; the oldest go first. */
const FOLLOWED_LIMIT = 500;

/**
 * What one bot reserves. Socket Mode events are split across every
 * connection of one Slack app, so the app is what two bots must not share.
 * Settings saved before the app was recorded fall back to the bot user.
 */
function appKey(config: Stored) {
  const app = config.appId ?? slackAppId(config.appToken);
  return app ? `app:${app}` : config.connectionId;
}

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
 * One Slack app per bot, keyed by the app (see `appKey`): Slack spreads
 * Socket Mode events across every open connection, so two bots sharing an
 * app would each miss messages.
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
      // Channel threads the bot follows without a mention. Thread IDs only;
      // no message content.
      db.exec(
        "CREATE TABLE IF NOT EXISTS followed (thread TEXT PRIMARY KEY, at INTEGER NOT NULL)",
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
        if (!connections.claim(appKey(stored), service))
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
            conflict: this.connections.conflicts(appKey(this.config), this),
          }
        : null,
    };
  }

  /**
   * Starts the bridge and opens its Socket Mode connection, which the SDK
   * keeps retrying and reconnects on its own. Returns at once, or with `wait`,
   * once Slack accepts the connection, failing after that many milliseconds.
   */
  private start(config: Stored): void;
  private start(config: Stored, wait: number): Promise<void>;
  private start(config: Stored, wait?: number) {
    const bridge = this.adapters.create(this.app, {
      ...config,
      followed: this.followed(),
      onFollow: (thread) => this.follow(thread),
    });
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

  private followed() {
    return this.db
      .query<{ thread: string }, [number]>(
        "SELECT thread FROM followed ORDER BY at DESC LIMIT ?",
      )
      .all(FOLLOWED_LIMIT)
      .map((row) => row.thread);
  }

  private follow(thread: string) {
    try {
      this.db
        .query("INSERT OR REPLACE INTO followed(thread,at) VALUES(?,?)")
        .run(thread, Date.now());
      this.db
        .query(
          "DELETE FROM followed WHERE thread NOT IN (SELECT thread FROM followed ORDER BY at DESC LIMIT ?)",
        )
        .run(FOLLOWED_LIMIT);
    } catch {
      // Closed while a reply was in flight: the thread is followed until restart.
    }
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
    // Tokens from two apps would connect one app's events to another's bot.
    const tokenApp = slackAppId(appToken);
    if (tokenApp && identity.appId && tokenApp !== identity.appId)
      throw new InputError(
        "The bot token and the app-level token come from different Slack apps. Use both from the same app.",
      );
    const appId = tokenApp ?? identity.appId;
    const next: Stored = {
      botToken,
      appToken,
      connectionId: identity.connectionId,
      botUserId: identity.botUserId,
      teamName: identity.teamName,
      allowedUserIds: input.allowedUserIds,
      channelId: input.channelId || undefined,
      ...(appId ? { appId } : {}),
    };
    const key = appKey(next);
    const previous = this.config ? appKey(this.config) : undefined;
    const heldBefore = previous === key;
    if (!this.connections.claim(key, this)) throw new InputError(conflict, 409);
    try {
      await this.stop();
      await this.start(next, this.adapters.connectTimeoutMs ?? 15_000);
    } catch {
      await this.stop();
      if (this.config) this.start(this.config);
      if (!heldBefore) this.connections.release(key, this);
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
      if (!heldBefore) this.connections.release(key, this);
      throw error;
    }
    // Settings saved before the app was recorded held the bot user instead.
    if (previous && !heldBefore) this.connections.release(previous, this);
    return this.read();
  }

  remove() {
    return this.serialize(async () => {
      await this.stop();
      this.db.query("DELETE FROM slack WHERE id=1").run();
      this.db.query("DELETE FROM followed").run();
      if (this.config) this.connections.release(appKey(this.config), this);
      this.config = null;
      return this.read();
    });
  }

  close() {
    return this.serialize(async () => {
      await this.stop();
      if (this.config) this.connections.release(appKey(this.config), this);
      this.cipher.close();
      this.db.close();
    });
  }
}

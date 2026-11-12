import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  SaveTelegramChannel,
  TelegramChannel,
  TelegramPairingCode,
  TelegramProblem,
} from "@raphie/contracts";

import type { ChannelServices } from "../../../application/channels/ports.ts";
import {
  createTelegramApi,
  type FetchRequest,
} from "../../../infrastructure/telegram/api.ts";
import { createTelegramBridge } from "../../../infrastructure/telegram/bridge.ts";
import { PairingCodes } from "../../../infrastructure/telegram/pairing.ts";
import { InputError } from "../../../shared/application/input-error.ts";
import { registerRedactionSecret } from "../../activity/infrastructure/pi-activity-journal.ts";
import {
  configuredCredentialKeyStore,
  CredentialCipher,
  type CredentialKeyStore,
} from "../../settings/infrastructure/credential-cipher.ts";
import type { ReplyDestination } from "../domain/binding.ts";

type Stored = {
  botToken: string;
  botId: string;
  botUsername: string;
  enabled: boolean;
  /** Verified Telegram user IDs, never usernames. */
  owners: string[];
};

export type TelegramOptions = {
  /** Tests only; production always talks to api.telegram.org. */
  apiBase?: string;
  fetch?: FetchRequest;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<unknown>;
  pollSeconds?: number;
  flushMs?: number;
};

const conflict =
  "This Telegram bot is already connected to another Raphie bot. Remove it from that bot first.";

/** Shared by all bots in one app-data directory: one poller per Telegram bot. */
export class TelegramConnections {
  private owners = new Map<string, BotTelegram>();

  claim(id: string, bot: BotTelegram) {
    const owner = this.owners.get(id);
    if (owner && owner !== bot) return false;
    this.owners.set(id, bot);
    return true;
  }

  conflicts(id: string, bot: BotTelegram) {
    const owner = this.owners.get(id);
    return !!owner && owner !== bot;
  }

  release(id: string, bot: BotTelegram) {
    if (this.owners.get(id) === bot) this.owners.delete(id);
  }
}

/** Per-bot Telegram configuration and lifecycle. The token never leaves this service. */
export class BotTelegram {
  private config: Stored | null = null;
  private problem: TelegramProblem | null = null;
  private nextOffset = 0;
  private running?: {
    abort: AbortController;
    timer: ReturnType<typeof setInterval>;
    polling: Promise<void>;
  };
  private readonly codes = new PairingCodes();
  private queue: Promise<unknown> = Promise.resolve();

  private readonly db: Database;
  private readonly cipher: CredentialCipher;
  private readonly app: ChannelServices;
  private readonly options: TelegramOptions;
  private readonly connections: TelegramConnections;

  private constructor(
    db: Database,
    cipher: CredentialCipher,
    app: ChannelServices,
    options: TelegramOptions,
    connections: TelegramConnections,
  ) {
    this.db = db;
    this.cipher = cipher;
    this.app = app;
    this.options = options;
    this.connections = connections;
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }

  static async open(
    path: string,
    app: ChannelServices,
    keyStore?: CredentialKeyStore,
    options: TelegramOptions = {},
    connections = new TelegramConnections(),
  ) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const db = new Database(path, { strict: true });
    let service: BotTelegram | undefined;
    try {
      await chmod(path, 0o600);
      db.exec(
        "CREATE TABLE IF NOT EXISTS telegram (id INTEGER PRIMARY KEY CHECK(id=1), key_id TEXT NOT NULL, value TEXT NOT NULL)",
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS cursor (id INTEGER PRIMARY KEY CHECK(id=1), next INTEGER NOT NULL)",
      );
      const row = db
        .query<{ key_id: string; value: string }, []>(
          "SELECT key_id,value FROM telegram WHERE id=1",
        )
        .get();
      const cipher = await CredentialCipher.open(
        keyStore ?? configuredCredentialKeyStore(),
        row?.key_id,
      );
      service = new BotTelegram(db, cipher, app, options, connections);
      service.nextOffset =
        db
          .query<{ next: number }, []>("SELECT next FROM cursor WHERE id=1")
          .get()?.next ?? 0;
      if (row) {
        service.config = JSON.parse(
          cipher.decrypt(JSON.parse(row.value), "telegram", "telegram")!,
        ) as Stored;
        registerRedactionSecret(service.config.botToken);
        service.start();
      }
      return service;
    } catch (error) {
      if (service) await service.close();
      else db.close();
      throw error;
    }
  }

  acceptsHome(
    address: ReplyDestination & {
      userId: string;
    },
  ) {
    return (
      !!this.config &&
      this.config.enabled &&
      this.read().telegram?.connected === true &&
      address.provider === "telegram" &&
      address.connectionId === `telegram:${this.config.botId}` &&
      address.conversation === `telegram:${address.userId}` &&
      this.config.owners.includes(address.userId)
    );
  }

  read(): { telegram: TelegramChannel | null } {
    const config = this.config;
    return {
      telegram: config
        ? {
            enabled: config.enabled,
            connected: !!this.running && this.problem === null,
            tokenConfigured: true,
            botUsername: config.botUsername,
            verifiedUserIds: [...config.owners],
            pairingExpiresAt: this.codes.expiresAt(),
            problem: this.problem,
          }
        : null,
    };
  }

  private persist(config: Stored) {
    this.db
      .query("INSERT OR REPLACE INTO telegram(id,key_id,value) VALUES(1,?,?)")
      .run(
        this.cipher.keyId,
        JSON.stringify(
          this.cipher.encrypt(JSON.stringify(config), "telegram", "telegram"),
        ),
      );
    this.config = config;
  }

  private start() {
    const config = this.config;
    if (!config?.enabled) return;
    if (!this.connections.claim(config.botId, this)) {
      this.problem = "duplicate";
      console.error(
        "Telegram bot is configured for multiple Raphie bots; this one will not connect.",
      );
      return;
    }
    this.problem = null;
    const bridge = createTelegramBridge(this.app, {
      token: config.botToken,
      botId: config.botId,
      apiBase: this.options.apiBase,
      fetch: this.options.fetch,
      sleep: this.options.sleep,
      pollSeconds: this.options.pollSeconds,
      owners: () => this.config?.owners ?? [],
      pair: (userId, code) => {
        const current = this.config;
        if (!current || !this.codes.consume(code)) return false;
        this.persist({
          ...current,
          owners: [...new Set([...current.owners, userId])],
        });
        return true;
      },
      cursor: {
        next: () => this.nextOffset,
        advance: (updateId) => {
          this.nextOffset = updateId + 1;
          this.db
            .query("INSERT OR REPLACE INTO cursor(id,next) VALUES(1,?)")
            .run(this.nextOffset);
        },
      },
      onProblem: (problem) => {
        this.problem = problem;
      },
    });
    const abort = new AbortController();
    const polling = bridge.poll(abort.signal).catch(() => {
      if (!abort.signal.aborted) console.error("Telegram listener stopped.");
    });
    const timer = setInterval(() => {
      void bridge
        .flush()
        .catch(() => console.error("Telegram delivery pump failed."));
    }, this.options.flushMs ?? 1000);
    this.running = { abort, timer, polling };
  }

  private async stop() {
    const running = this.running;
    this.running = undefined;
    this.problem = null;
    if (!running) return;
    running.abort.abort();
    clearInterval(running.timer);
    await running.polling;
    if (this.config) this.connections.release(this.config.botId, this);
  }

  save(input: SaveTelegramChannel) {
    return this.serialize(() => this.saveLocked(input));
  }

  private async saveLocked(input: SaveTelegramChannel) {
    const botToken = input.botToken || this.config?.botToken;
    if (!botToken) throw new InputError("Enter a Telegram bot token.");
    registerRedactionSecret(botToken);
    let identity: { id: string; username: string };
    if (this.config && !input.botToken)
      identity = { id: this.config.botId, username: this.config.botUsername };
    else {
      try {
        const me = await createTelegramApi(botToken, {
          baseUrl: this.options.apiBase,
          fetch: this.options.fetch,
        }).getMe();
        identity = { id: String(me.id), username: me.username ?? "" };
      } catch {
        throw new InputError(
          "Telegram connection failed. Check the bot token and your network.",
        );
      }
    }
    if (this.config && this.config.botId !== identity.id)
      throw new InputError(
        "Use the same Telegram bot or remove the existing connection first.",
      );
    const enabled = input.enabled ?? this.config?.enabled ?? true;
    if (enabled && this.connections.conflicts(identity.id, this))
      throw new InputError(conflict, 409);
    await this.stop();
    this.persist({
      botToken,
      botId: identity.id,
      botUsername: identity.username,
      enabled,
      owners: this.config?.owners ?? [],
    });
    this.start();
    return this.read();
  }

  /** The code is returned once and only its live copy exists, in memory. */
  pairingCode(): TelegramPairingCode {
    if (!this.config) throw new InputError("Connect a Telegram bot first.");
    if (!this.config.enabled || !this.running)
      throw new InputError("Enable and connect Telegram before pairing.");
    return this.codes.issue();
  }

  unpair(userId: string) {
    return this.serialize(async () => {
      if (!this.config) throw new InputError("Telegram is not configured.");
      this.persist({
        ...this.config,
        owners: this.config.owners.filter((id) => id !== userId),
      });
      return this.read();
    });
  }

  remove() {
    return this.serialize(async () => {
      await this.stop();
      this.db.query("DELETE FROM telegram WHERE id=1").run();
      this.db.query("DELETE FROM cursor WHERE id=1").run();
      this.config = null;
      this.nextOffset = 0;
      this.codes.clear();
      return this.read();
    });
  }

  close() {
    return this.serialize(async () => {
      await this.stop();
      this.cipher.close();
      this.db.close();
    });
  }
}

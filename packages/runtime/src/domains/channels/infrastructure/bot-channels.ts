import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { ChannelServices } from "../../../application/channels/ports.ts";
import {
  createDiscordBridge,
  resolveDiscordApplication,
  resolveDiscordThread,
} from "../../../infrastructure/discord/bridge.ts";
import { InputError } from "../../../shared/application/input-error.ts";
import { registerRedactionSecret } from "../../activity/infrastructure/pi-activity-journal.ts";
import {
  CredentialCipher,
  type CredentialKeyStore,
  osCredentialKeyStore,
} from "../../settings/infrastructure/credential-cipher.ts";

type DiscordConfig = {
  botToken: string;
  applicationId: string;
  allowedUserIds: string[];
  channelId?: string;
  guildId?: string;
};

type LegacyDiscordConfig = DiscordConfig & {
  ownerId?: string;
  publicKey?: string;
};

type SaveDiscord = {
  botToken?: string;
  allowedUserIds: string[];
  channelId?: string;
};

type Bridge = ReturnType<typeof createDiscordBridge>;

type Adapters = {
  resolve: typeof resolveDiscordThread;
  application: typeof resolveDiscordApplication;
  create: typeof createDiscordBridge;
};

/** Per-bot channel configuration and lifecycle. Credentials never leave this service. */
export class BotChannels {
  private config: DiscordConfig | null = null;
  private bridge?: Bridge;
  private abort?: AbortController;
  private timer?: ReturnType<typeof setInterval>;
  private db: Database;
  private cipher: CredentialCipher;
  private app: ChannelServices;
  private adapters: Adapters;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    db: Database,
    cipher: CredentialCipher,
    app: ChannelServices,
    adapters: Adapters,
  ) {
    this.db = db;
    this.cipher = cipher;
    this.app = app;
    this.adapters = adapters;
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
    adapters: Adapters = {
      resolve: resolveDiscordThread,
      application: resolveDiscordApplication,
      create: createDiscordBridge,
    },
  ) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const db = new Database(path, { strict: true });
    let service: BotChannels | undefined;
    try {
      await chmod(path, 0o600);
      db.exec(
        "CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY CHECK(id=1), key_id TEXT NOT NULL, value TEXT NOT NULL)",
      );
      const row = db
        .query<{ key_id: string; value: string }, []>(
          "SELECT key_id,value FROM channels WHERE id=1",
        )
        .get();
      const cipher = await CredentialCipher.open(
        keyStore ?? osCredentialKeyStore,
        row?.key_id,
      );
      service = new BotChannels(db, cipher, app, adapters);
      if (row) {
        const stored = JSON.parse(
          cipher.decrypt(JSON.parse(row.value), "channels", "channels")!,
        ) as LegacyDiscordConfig;
        service.config = {
          botToken: stored.botToken,
          applicationId: stored.applicationId,
          allowedUserIds:
            stored.allowedUserIds ?? (stored.ownerId ? [stored.ownerId] : []),
          channelId: stored.channelId || undefined,
          guildId: stored.guildId || undefined,
        };
      }
      if (service.config) {
        registerRedactionSecret(service.config.botToken);
        try {
          await service.start(service.config);
        } catch {
          console.error(
            "Discord channel could not connect. Check this bot's channel settings.",
          );
        }
      }
      return service;
    } catch (error) {
      if (service) await service.close();
      else db.close();
      throw error;
    }
  }

  read() {
    return {
      discord: this.config
        ? {
            allowedUserIds: this.config.allowedUserIds,
            channelId: this.config.channelId ?? "",
            connected: !!this.bridge,
            tokenConfigured: true,
          }
        : null,
    };
  }

  private async start(config: DiscordConfig) {
    const threadId = config.channelId
      ? await this.adapters.resolve({ ...config, channelId: config.channelId })
      : undefined;
    const bridge = this.adapters.create(this.app, {
      ...config,
      threadId,
      respondToChannelIds: config.channelId ? [config.channelId] : [],
    });
    await bridge.chat.initialize();
    const abort = new AbortController();
    this.bridge = bridge;
    this.abort = abort;
    void bridge.listen(abort.signal).catch(() => {
      if (!abort.signal.aborted) console.error("Discord listener stopped.");
    });
    this.timer = setInterval(() => {
      void bridge
        .flush()
        .catch(() => console.error("Discord delivery pump failed."));
    }, 1000);
  }

  private async stop() {
    this.abort?.abort();
    if (this.timer) clearInterval(this.timer);
    const bridge = this.bridge;
    this.bridge = undefined;
    this.abort = undefined;
    this.timer = undefined;
    await bridge?.chat.shutdown();
  }

  save(input: SaveDiscord) {
    return this.serialize(() => this.saveLocked(input));
  }

  private async saveLocked(input: SaveDiscord) {
    const botToken = input.botToken || this.config?.botToken;
    if (!botToken) throw new InputError("Enter a Discord bot token.");
    registerRedactionSecret(botToken);
    let next: DiscordConfig;
    try {
      const applicationId = await this.adapters.application(botToken);
      if (this.config && this.config.applicationId !== applicationId)
        throw new InputError(
          "Use the same Discord application or remove the existing connection first.",
        );
      next = {
        botToken,
        applicationId,
        allowedUserIds: input.allowedUserIds,
        channelId: input.channelId || undefined,
        guildId:
          input.channelId && input.channelId === this.config?.channelId
            ? this.config.guildId
            : undefined,
      };
      if (next.channelId)
        await this.adapters.resolve({ ...next, channelId: next.channelId });
    } catch (error) {
      if (error instanceof InputError) throw error;
      throw new InputError(
        "Discord connection failed. Check the token, channel ID and bot permissions.",
      );
    }
    await this.stop();
    try {
      await this.start(next);
    } catch {
      if (this.config) await this.start(this.config).catch(() => {});
      throw new InputError(
        "Discord connection failed. Check the settings and try again.",
      );
    }
    try {
      this.db
        .query("INSERT OR REPLACE INTO channels(id,key_id,value) VALUES(1,?,?)")
        .run(
          this.cipher.keyId,
          JSON.stringify(
            this.cipher.encrypt(JSON.stringify(next), "channels", "channels"),
          ),
        );
      this.config = next;
    } catch (error) {
      await this.stop();
      if (this.config) await this.start(this.config).catch(() => {});
      throw error;
    }
    return this.read();
  }

  remove() {
    return this.serialize(async () => {
      await this.stop();
      this.db.query("DELETE FROM channels WHERE id=1").run();
      this.config = null;
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

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChannelServices } from "../src/application/channels/ports.ts";
import { BotChannels } from "../src/domains/channels/infrastructure/bot-channels.ts";
import { CredentialCipher } from "../src/domains/settings/infrastructure/credential-cipher.ts";
import {
  discordAuthorized,
  resolveDiscordApplication,
} from "../src/infrastructure/discord/bridge.ts";
import type {
  createDiscordBridge,
  resolveDiscordThread,
} from "../src/infrastructure/discord/bridge.ts";

describe("bot channels", () => {
  test("isolates encrypted settings, reconnects on restart, and preserves a saved token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "raphie-channels-"));
    const keys = new Map<string, string>();
    const store = {
      get: async (id: string) => keys.get(id) ?? null,
      set: async (id: string, value: string) => {
        keys.set(id, value);
      },
    };
    const starts: string[] = [];
    let stopped = 0;
    const adapters = {
      application: async () => "1",
      resolve: (async () => "discord:1:2") as typeof resolveDiscordThread,
      create: ((_app, config) => {
        starts.push(config.botToken as string);
        return {
          chat: {
            initialize: async () => {},
            shutdown: async () => {
              stopped++;
            },
          },
          listen: async () => {},
          flush: async () => {},
        } as unknown as ReturnType<typeof createDiscordBridge>;
      }) as typeof createDiscordBridge,
    };
    const app = {} as ChannelServices;
    const firstPath = join(directory, "one.sqlite");
    let first = await BotChannels.open(firstPath, app, store, adapters);
    const second = await BotChannels.open(
      join(directory, "two.sqlite"),
      app,
      store,
      adapters,
    );
    const config = {
      botToken: "private-token-example",
      allowedUserIds: ["2"],
      channelId: "3",
    };
    try {
      await first.save(config);
      expect(first.read().discord?.connected).toBe(true);
      expect(second.read().discord).toBeNull();
      expect(JSON.stringify(first.read())).not.toContain(config.botToken);
      expect((await readFile(firstPath)).includes(config.botToken)).toBe(false);
      await first.save({ ...config, botToken: undefined, channelId: "4" });
      await first.close();
      first = await BotChannels.open(firstPath, app, store, adapters);
      expect(first.read().discord?.channelId).toBe("4");
      expect(starts).toEqual([
        config.botToken,
        config.botToken,
        config.botToken,
      ]);
      await first.remove();
      expect(first.read().discord).toBeNull();
      expect(stopped).toBe(3);
    } finally {
      await first.close();
      await second.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test("Discord authorization denies empty lists and enforces optional channel and thread restrictions", () => {
  const parent = { guildId: "1", channelId: "2" };
  const thread = { ...parent, threadId: "3" };
  expect(discordAuthorized("10", [], parent)).toBe(false);
  expect(discordAuthorized("10", ["10", "11"], thread)).toBe(true);
  expect(discordAuthorized("12", ["10", "11"], parent)).toBe(false);
  expect(discordAuthorized("11", ["10", "11"], thread, parent)).toBe(true);
  expect(
    discordAuthorized("11", ["11"], { guildId: "1", channelId: "4" }, parent),
  ).toBe(false);
  expect(discordAuthorized("11", ["11"], parent, thread)).toBe(false);
});

test("Discord application identity is discovered with the token", async () => {
  const lookup = (async (_url, request) => {
    expect(request?.headers).toEqual({ Authorization: "Bot test-token" });
    return Response.json({ id: "123" });
  }) as typeof fetch;
  expect(await resolveDiscordApplication("test-token", lookup)).toBe("123");
  const failed = await resolveDiscordApplication(
    "bad",
    (async () => new Response("", { status: 401 })) as unknown as typeof fetch,
  ).then(
    () => false,
    () => true,
  );
  expect(failed).toBe(true);
});

test("legacy owner and channel settings are retained on reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-channel-migration-"));
  const keys = new Map<string, string>();
  const store = {
    get: async (id: string) => keys.get(id) ?? null,
    set: async (id: string, value: string) => {
      keys.set(id, value);
    },
  };
  const path = join(directory, "channels.sqlite");
  const cipher = await CredentialCipher.open(store);
  const db = new Database(path);
  db.exec(
    "CREATE TABLE channels (id INTEGER PRIMARY KEY, key_id TEXT NOT NULL, value TEXT NOT NULL)",
  );
  db.query("INSERT INTO channels VALUES(1, ?, ?)").run(
    cipher.keyId,
    JSON.stringify(
      cipher.encrypt(
        JSON.stringify({
          botToken: "legacy-token",
          applicationId: "1",
          ownerId: "2",
          channelId: "3",
          guildId: "4",
          publicKey: "a".repeat(64),
        }),
        "channels",
        "channels",
      ),
    ),
  );
  db.close();
  cipher.close();
  let observed: unknown;
  const adapters = {
    application: async () => "1",
    resolve: (async (config) => {
      observed = config;
      return "discord:4:3";
    }) as typeof resolveDiscordThread,
    create: (() => ({
      chat: { initialize: async () => {}, shutdown: async () => {} },
      listen: async () => {},
      flush: async () => {},
    })) as unknown as typeof createDiscordBridge,
  };
  const channels = await BotChannels.open(
    path,
    {} as ChannelServices,
    store,
    adapters,
  );
  try {
    expect(channels.read().discord).toMatchObject({
      allowedUserIds: ["2"],
      channelId: "3",
    });
    expect(observed).toMatchObject({ guildId: "4", channelId: "3" });
  } finally {
    await channels.close();
    await rm(directory, { recursive: true, force: true });
  }
});

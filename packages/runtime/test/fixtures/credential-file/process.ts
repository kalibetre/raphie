import assert from "node:assert/strict";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

import type { ChannelServices } from "../../../src/application/channels/ports.ts";
import { BotChannels } from "../../../src/domains/channels/infrastructure/bot-channels.ts";
import { BotMcp } from "../../../src/domains/settings/infrastructure/bot-mcp.ts";
import { BackendSettings } from "../../../src/domains/settings/infrastructure/runtime-settings.ts";
import type {
  createDiscordBridge,
  resolveDiscordThread,
} from "../../../src/infrastructure/discord/bridge.ts";
import { ModelConnectionGate } from "../../../src/shared/infrastructure/model-connection-gate.ts";

const [directory, mode] = process.argv.slice(2) as [string, string];
for (const bot of ["default", "named"]) {
  const models = createModels();
  models.setProvider(openrouterProvider());
  const settings = await BackendSettings.open(
    join(directory, bot, "settings.sqlite"),
    {
      models,
      defaultModel: models.getModels("openrouter")[0]!.id,
      verifyKey: async () => {},
    },
  );
  try {
    if (mode === "write")
      await settings.update({
        apiKey: `SYNTHETIC_PROVIDER_${bot}`,
        providerEnabled: true,
      });
    assert.equal(settings.key, `SYNTHETIC_PROVIDER_${bot}`);
    assert.doesNotMatch(JSON.stringify(await settings.read()), /SYNTHETIC/);
  } finally {
    settings.close();
  }

  const mcp = await BotMcp.open(join(directory, bot, "mcp.sqlite"), {
    gate: new ModelConnectionGate(),
    busy: async () => false,
    publish: () => {},
    connect: async (connection) => {
      assert.equal(connection.transport, "http");
      if (connection.transport === "http")
        assert.equal(connection.token, `SYNTHETIC_MCP_${bot}`);
      return {
        server: { name: "fixture", version: "1" },
        tools: [],
        call: async () => ({ content: [] }),
        close: async () => {},
      };
    },
  });
  try {
    if (mode === "write")
      await mcp.add({
        name: "Fixture",
        transport: "http",
        url: "http://localhost/mcp",
        token: `SYNTHETIC_MCP_${bot}`,
      });
    assert.equal(mcp.read()[0]?.connected, true);
    assert.doesNotMatch(JSON.stringify(mcp.read()), /SYNTHETIC/);
  } finally {
    await mcp.close();
  }

  const channels = await BotChannels.open(
    join(directory, bot, "channels.sqlite"),
    {} as ChannelServices,
    undefined,
    {
      application: async () => "1",
      resolve: (async () => "discord:1:2") as typeof resolveDiscordThread,
      create: ((_app, config) => {
        assert.equal(config.botToken, `SYNTHETIC_DISCORD_${bot}`);
        return {
          chat: { initialize: async () => {}, shutdown: async () => {} },
          listen: async () => {},
          flush: async () => {},
        } as unknown as ReturnType<typeof createDiscordBridge>;
      }) as typeof createDiscordBridge,
    },
  );
  try {
    if (mode === "write")
      await channels.save({
        botToken: `SYNTHETIC_DISCORD_${bot}`,
        allowedUserIds: ["2"],
      });
    assert.equal(channels.read().discord?.connected, true);
    assert.doesNotMatch(JSON.stringify(channels.read()), /SYNTHETIC/);
  } finally {
    await channels.close();
  }
}
console.log("File-backed credential stores reopened successfully.");

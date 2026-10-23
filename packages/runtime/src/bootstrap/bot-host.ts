import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { SaveBotProfile, UpdateBotProfile } from "@raphie/contracts";

import type { BotProfiles } from "../domains/bots/application/ports.ts";
import { BotProfileStore } from "../domains/bots/infrastructure/bot-profiles.ts";
import type { MemoryService } from "../domains/memory/application/ports.ts";
import { RuntimeMemory } from "../domains/memory/infrastructure/runtime-memory.ts";
import type { SettingsService } from "../domains/settings/application/ports.ts";
import { BackendSettings } from "../domains/settings/infrastructure/runtime-settings.ts";
import { InputError } from "../shared/application/input-error.ts";
import { Gateway } from "./agent-runtime.ts";

export type BotRuntime = {
  gateway: Gateway;
  settings?: SettingsService;
  memory?: MemoryService;
  close(): Promise<void>;
};

type OpenBot = (id: string, directory: string) => Promise<BotRuntime>;

/** One process, separate storage and authorities. Only bootstrap holds every bot. */
export class BotHost implements BotProfiles {
  private readonly profiles: BotProfileStore;
  private readonly runtimes = new Map<string, BotRuntime>();

  private readonly directory: string;
  private readonly openBot: OpenBot;

  private constructor(directory: string, openBot: OpenBot) {
    this.directory = directory;
    this.openBot = openBot;
    this.profiles = new BotProfileStore(join(directory, "bots.sqlite"));
  }

  static async open(
    directory: string,
    existing: Omit<BotRuntime, "close">,
    openBot: OpenBot = openIsolatedBot,
  ) {
    const host = new BotHost(directory, openBot);
    host.runtimes.set("default", { ...existing, close: async () => {} });
    try {
      await mkdir(join(directory, "workspace"), {
        recursive: true,
        mode: 0o700,
      });
      existing.gateway.setPersonality(() => host.profiles.read("default"));
      for (const profile of host.profiles.list()) {
        if (profile.id === "default") continue;
        const runtime = await openBot(
          profile.id,
          join(directory, "bots", profile.id),
        );
        runtime.gateway.setPersonality(() => host.profiles.read(profile.id));
        host.runtimes.set(profile.id, runtime);
      }
      return host;
    } catch (error) {
      await host.close();
      throw error;
    }
  }

  list() {
    return this.profiles.list();
  }

  read(id: string) {
    return this.profiles.read(id);
  }

  history(id: string) {
    return this.profiles.history(id);
  }

  runtime(id: string) {
    this.profiles.read(id);
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new InputError("Bot is unavailable.", 503);
    return runtime;
  }

  async create(input: SaveBotProfile) {
    const profile = this.profiles.draft(input);
    const directory = join(this.directory, "bots", profile.id);
    const runtime = await this.openBot(profile.id, directory);
    try {
      await mkdir(join(directory, "workspace"), {
        recursive: true,
        mode: 0o700,
      });
      this.profiles.insert(profile);
      runtime.gateway.setPersonality(() => this.profiles.read(profile.id));
      this.runtimes.set(profile.id, runtime);
      return profile;
    } catch (error) {
      await runtime.close();
      throw error;
    }
  }

  async update(id: string, input: UpdateBotProfile) {
    const { gateway } = this.runtime(id);
    return gateway.configurationGate.run(async () => {
      if (
        (await gateway.chats.state()).turns.some((t) => t.status === "pending")
      )
        throw new InputError(
          "Wait for this bot's active turns to finish before editing its personality.",
          409,
        );
      return this.profiles.update(id, input);
    });
  }

  async close() {
    const results = await Promise.allSettled(
      [...this.runtimes.values()].map((runtime) => runtime.close()),
    );
    this.profiles.close();
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
}

async function openIsolatedBot(
  botId: string,
  directory: string,
): Promise<BotRuntime> {
  const models = createModels();
  models.setProvider(openrouterProvider());
  const settings = await BackendSettings.open(
    join(directory, "settings.sqlite"),
    {
      models,
      defaultModel: "anthropic/claude-haiku-5.5",
    },
  );
  let memory: RuntimeMemory | undefined;
  let gateway: Gateway | undefined;
  try {
    memory = new RuntimeMemory(
      join(directory, "memory.sqlite"),
      settings,
      settings.connectionGate,
      botId,
    );
    gateway = await Gateway.open({
      botId,
      directory,
      models,
      model: settings.model,
      memory,
      modelConnectionGate: settings.connectionGate,
    });
    const app = gateway;
    settings.onChange = () => {
      app.chats.model = settings.model;
    };
    memory.isBusy = settings.isBusy = async () =>
      (await app.chats.state()).turns.some((t) => t.status === "pending");
    return {
      gateway,
      settings,
      memory,
      close: async () => {
        try {
          await app.close();
        } finally {
          memory?.close();
          settings.close();
        }
      },
    };
  } catch (error) {
    await gateway?.close();
    memory?.close();
    settings.close();
    throw error;
  }
}

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { SaveBotProfile, UpdateBotProfile } from "@raphie/contracts";

import type { BotProfiles } from "../domains/bots/application/ports.ts";
import { BotProfileStore } from "../domains/bots/infrastructure/bot-profiles.ts";
import {
  BotChannels,
  DiscordApplications,
} from "../domains/channels/infrastructure/bot-channels.ts";
import {
  BotTelegram,
  TelegramConnections,
  type TelegramOptions,
} from "../domains/channels/infrastructure/bot-telegram.ts";
import type { MemoryService } from "../domains/memory/application/ports.ts";
import { RuntimeMemory } from "../domains/memory/infrastructure/runtime-memory.ts";
import { BotJobs } from "../domains/schedules/infrastructure/bot-jobs.ts";
import { createScheduleTools } from "../domains/schedules/infrastructure/schedule-tools.ts";
import type { SettingsService } from "../domains/settings/application/ports.ts";
import { BotMcp } from "../domains/settings/infrastructure/bot-mcp.ts";
import type { CredentialKeyStore } from "../domains/settings/infrastructure/credential-cipher.ts";
import { BackendSettings } from "../domains/settings/infrastructure/runtime-settings.ts";
import { ContainerWorkspace } from "../domains/workspaces/infrastructure/container-workspace.ts";
import type { McpConnection } from "../infrastructure/mcp/client.ts";
import { InputError } from "../shared/application/input-error.ts";
import { Gateway } from "./agent-runtime.ts";

export type BotRuntime = {
  gateway: Gateway;
  settings?: SettingsService;
  memory?: MemoryService;
  mcp?: BotMcp;
  jobs?: BotJobs;
  channels?: BotChannels;
  telegram?: BotTelegram;
  close(): Promise<void>;
};

type OpenBot = (id: string, directory: string) => Promise<BotRuntime>;

type Automation = {
  keyStore?: CredentialKeyStore;
  legacyMcp?: McpConnection;
  telegram?: TelegramOptions;
};

/** One process, separate storage and authorities. Only bootstrap holds every bot. */
export class BotHost implements BotProfiles {
  private readonly profiles: BotProfileStore;
  private readonly runtimes = new Map<string, BotRuntime>();
  private readonly discordApplications = new DiscordApplications();
  private readonly telegramConnections = new TelegramConnections();

  private readonly directory: string;
  private readonly openBot: OpenBot;
  private automation?: Automation;

  private constructor(
    directory: string,
    openBot: OpenBot,
    automation?: Automation,
  ) {
    this.directory = directory;
    this.openBot = openBot;
    this.automation = automation;
    this.profiles = new BotProfileStore(join(directory, "bots.sqlite"));
  }

  static async open(
    directory: string,
    existing: Omit<BotRuntime, "close">,
    openBot: OpenBot = openIsolatedBot,
    automation?: Automation,
  ) {
    const host = new BotHost(directory, openBot, automation);
    try {
      for (const id of host.profiles.deletions()) await host.finishDeletion(id);
      host.runtimes.set(
        "default",
        await host.attach({ ...existing, close: async () => {} }, directory),
      );
      await mkdir(join(directory, "workspace"), {
        recursive: true,
        mode: 0o700,
      });
      existing.gateway.setPersonality(() => host.profiles.read("default"));
      for (const profile of host.profiles.list()) {
        if (profile.id === "default") continue;
        const runtime = await host.attach(
          await openBot(profile.id, join(directory, "bots", profile.id)),
          join(directory, "bots", profile.id),
        );
        runtime.gateway.setPersonality(() => host.profiles.read(profile.id));
        host.runtimes.set(profile.id, runtime);
      }
      // Recover only after every bot's tools, task definitions and identity exist.
      for (const runtime of host.runtimes.values())
        runtime.gateway.harness.resume();
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
    const runtime = await this.attach(
      await this.openBot(profile.id, directory),
      directory,
    );
    try {
      await mkdir(join(directory, "workspace"), {
        recursive: true,
        mode: 0o700,
      });
      this.profiles.insert(profile);
      runtime.gateway.setPersonality(() => this.profiles.read(profile.id));
      this.runtimes.set(profile.id, runtime);
      runtime.gateway.harness.resume();
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

  async delete(id: string, input: { name: string; revision: number }) {
    if (id === "default")
      throw new InputError("The default bot cannot be deleted.", 409);
    const runtime = this.runtime(id);
    await runtime.gateway.configurationGate.run(async () => {
      const profile = this.read(id);
      if (profile.revision !== input.revision || profile.name !== input.name)
        throw new InputError(
          "This bot changed. Reload its profile and confirm its current name.",
          409,
        );
      const gateway = runtime.gateway;
      const chats = await gateway.chats.state();
      const files = await gateway.state();
      const tools = await gateway.toolApprovals.state();
      const workspace = await gateway.workspace.info();
      if (
        chats.turns.some((turn) => turn.status === "pending") ||
        files.approvals.some(
          (approval) =>
            approval.status === "pending" ||
            (approval.status === "approved" && approval.completedAt === null),
        ) ||
        tools.approvals.some(
          (approval) =>
            approval.status === "pending" || approval.execution === "running",
        ) ||
        workspace.executions.admitted > 0
      )
        throw new InputError(
          "Finish or cancel this bot's active turns, workspace executions and pending approvals before deleting it.",
          409,
        );
      this.profiles.markDeleting(id);
      gateway.configurationGate.retire();
    });
    try {
      await runtime.close();
      this.runtimes.delete(id);
      await this.finishDeletion(id);
    } catch {
      throw new InputError(
        "Bot deletion is pending cleanup. Restart Raphie to retry; the bot will not resume work.",
        503,
      );
    }
  }

  private async finishDeletion(id: string) {
    // IDs are host-issued UUIDs. Never turn an untrusted tombstone into a path.
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
    )
      throw new Error("Invalid bot deletion identity");
    const directory = join(this.directory, "bots", id);
    await ContainerWorkspace.reapForDeletion(directory);
    await rm(directory, { recursive: true, force: true });
    this.profiles.finishDeletion(id);
  }

  private async attach(
    runtime: BotRuntime,
    directory: string,
  ): Promise<BotRuntime> {
    const { gateway } = runtime;
    gateway.options.identity =
      this.runtimes.get("default")?.gateway.options.identity ??
      gateway.options.identity;
    if (!this.automation) return runtime;
    let mcp: BotMcp | undefined;
    let channels: BotChannels | undefined;
    let telegram: BotTelegram | undefined;
    try {
      const busy = async () =>
        (await gateway.chats.state()).turns.some((t) => t.status === "pending");
      mcp = await BotMcp.open(join(directory, "mcp.sqlite"), {
        keyStore: this.automation.keyStore,
        legacy:
          directory === this.directory ? this.automation.legacyMcp : undefined,
        gate: gateway.configurationGate,
        busy,
        publish: (tools) => gateway.setMcp(tools),
      });
      channels = await BotChannels.open(
        join(directory, "channels.sqlite"),
        gateway,
        this.automation.keyStore,
        undefined,
        this.discordApplications,
      );
      telegram = await BotTelegram.open(
        join(directory, "telegram.sqlite"),
        gateway,
        this.automation.keyStore,
        this.automation.telegram,
        this.telegramConnections,
      );
      gateway.home.available = (address) =>
        !!(channels?.acceptsHome(address) || telegram?.acceptsHome(address));
      const actor = gateway.actors.establish("web");
      const jobs = BotJobs.open({
        root: gateway.root,
        harness: gateway.harness,
        install: (extension) => gateway.install(extension),
        busy,
        submit: (input) => gateway.sessions.submitScheduled(actor, input),
      });
      const connections = mcp;
      gateway.install(createScheduleTools(jobs));
      return {
        ...runtime,
        mcp,
        jobs,
        channels,
        telegram,
        close: async () => {
          try {
            try {
              try {
                await telegram?.close();
              } finally {
                await channels?.close();
              }
            } finally {
              await runtime.close();
            }
          } finally {
            await connections.close();
          }
        },
      };
    } catch (error) {
      await telegram?.close();
      await channels?.close();
      await mcp?.close();
      await runtime.close();
      throw error;
    }
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
      deferResume: true,
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

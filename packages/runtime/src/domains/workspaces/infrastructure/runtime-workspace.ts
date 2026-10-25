import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { SandboxInfo, SaveSandboxSettings } from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import { ModelConnectionGate } from "../../../shared/infrastructure/model-connection-gate.ts";
import { BotWorkspace } from "./bot-workspace.ts";
import { containerLimits } from "./container-cli.ts";
import { ContainerFiles } from "./container-files.ts";
import { ContainerWorkspace } from "./container-workspace.ts";
import { sandboxProviders } from "./sandbox-settings.ts";

type Options = {
  directory: string;
  workspaceId: string;
  containerEnabled: boolean;
  namePrefix?: string;
};

/** One bot's provider selection; provider stores retain separate files on switches. */
export class RuntimeWorkspace {
  private readonly checkpoint: BotWorkspace;
  private readonly options: Options;
  private container?: ContainerWorkspace;
  private readonly views = new ModelConnectionGate();

  private constructor(checkpoint: BotWorkspace, options: Options) {
    this.checkpoint = checkpoint;
    this.options = options;
  }

  static async open(options: Options) {
    const providers = sandboxProviders.map((entry) =>
      entry.id === "container"
        ? {
            ...entry,
            available: options.containerEnabled,
            reason: options.containerEnabled ? null : entry.reason,
          }
        : entry,
    );
    const checkpoint = await BotWorkspace.open(
      join(options.directory, "workspace", "checkpoint.sqlite"),
      providers,
    );
    const workspace = new RuntimeWorkspace(checkpoint, options);
    try {
      if (checkpoint.settings().provider === "container") {
        // Reap the previous epoch even if the owner revoked the network opt-in
        // after a crash. Opening control state never starts a new container.
        workspace.container = await workspace.openContainer(
          checkpoint.settings(),
        );
        if (!options.containerEnabled)
          throw new Error(
            "This bot uses container execution, but the host/LAN network policy has not been accepted. Re-enable the explicit opt-in before starting; files were preserved.",
          );
      }
      return workspace;
    } catch (error) {
      await workspace.close();
      throw error;
    }
  }

  private openContainer(settings: {
    idleMinutes: number;
    diskQuotaMiB: number | null;
  }) {
    return ContainerWorkspace.open({ ...this.options, ...settings });
  }

  settings() {
    return this.checkpoint.settings();
  }

  async saveSettings(input: SaveSandboxSettings) {
    return this.views.run(async () => {
      this.checkpoint.validateSettings(input);
      if (
        this.container?.admitted ||
        this.checkpoint.info().executions.admitted
      )
        throw new InputError(
          "Wait for this bot's workspace operations to finish before changing sandbox settings.",
          409,
        );
      const before = this.settings();
      const previous = this.container;
      // Acquire an empty newer epoch even when switching away from containers.
      // It reaps all old writers before the settings commit and remains available
      // to restore native ownership if that commit fails.
      const next =
        input.provider === "container" || before.provider === "container"
          ? await this.openContainer(
              input.provider === "container"
                ? { ...input, diskQuotaMiB: input.diskQuotaMiB ?? null }
                : before,
            )
          : undefined;
      try {
        const saved = this.checkpoint.saveSettings(input);
        this.container = input.provider === "container" ? next : undefined;
        if (input.provider !== "container") await next?.close();
        return saved;
      } catch (error) {
        await next?.close();
        this.container = undefined;
        if (before.provider === "container") {
          try {
            this.container = await this.openContainer(before);
          } catch {
            /* Leave the selected provider unavailable until a successful save/restart. */
          }
        }
        throw error;
      } finally {
        // A successful epoch acquisition already reaped the previous container.
        // Finish releasing its DB handle even if the daemon now becomes unavailable.
        if (next) await previous?.close().catch(() => {});
      }
    });
  }

  private selectedContainer() {
    if (this.settings().provider !== "container") return undefined;
    if (!this.container)
      throw new InputError(
        "The selected container provider is unavailable. Save its settings again or restart the runtime; files were preserved.",
        409,
      );
    return this.container;
  }

  env(operationId: string) {
    const container = this.selectedContainer();
    if (!container)
      throw new InputError(
        "Container coding tools are unavailable for this bot.",
        409,
      );
    return container.env("/workspace", operationId);
  }

  // Legacy just-bash capability, retained for the checkpoint tool and recovery.
  execute(...args: Parameters<BotWorkspace["execute"]>) {
    if (this.settings().provider !== "just-bash")
      throw new InputError("Use the container coding tools for this bot.", 409);
    return this.checkpoint.execute(...args);
  }

  async info(): Promise<SandboxInfo> {
    return this.views.run(async () => {
      const base = this.checkpoint.info();
      const container = this.selectedContainer();
      if (!container) return base;
      return {
        ...base,
        provider: { id: "container", name: "Container", version: "native" },
        isolation: "container",
        capabilities: { network: true, hostFiles: false, nativeCode: true },
        revision: base.settings.revision,
        executions: {
          admitted: container.admitted,
          capacity: containerLimits.queued,
          runtimeConcurrency: containerLimits.concurrent,
        },
        usage: {
          fileBytes: await container.usage(context),
          entries: null,
          receiptBytes: null,
        },
        limits: {
          ...containerLimits,
          fileBytes:
            base.settings.diskQuotaMiB === null
              ? null
              : base.settings.diskQuotaMiB * 1024 * 1024,
          entries: null,
          receiptsBytes: null,
        },
      };
    });
  }

  list(path?: string) {
    return this.views.run(() => {
      const container = this.selectedContainer();
      return container
        ? new ContainerFiles(container.env("/workspace", undefined, true)).list(
            path,
          )
        : Promise.resolve(this.checkpoint.list(path));
    });
  }

  download(path: string, revision: number) {
    return this.views.run(() => {
      const container = this.selectedContainer();
      return container
        ? new ContainerFiles(
            container.env("/workspace", undefined, true),
          ).download(path, revision)
        : Promise.resolve(this.checkpoint.download(path, revision));
    });
  }

  async close() {
    try {
      await this.container?.close();
    } finally {
      await this.checkpoint.close();
    }
  }
}

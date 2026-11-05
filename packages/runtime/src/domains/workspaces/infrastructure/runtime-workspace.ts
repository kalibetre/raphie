import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { SandboxInfo, SaveSandboxSettings } from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import { ModelConnectionGate } from "../../../shared/infrastructure/model-connection-gate.ts";
import { BotWorkspace } from "./bot-workspace.ts";
import { containerLimits, ContainerRuntimeError } from "./container-cli.ts";
import { ContainerFiles } from "./container-files.ts";
import { ContainerWorkspace } from "./container-workspace.ts";
import {
  diskCheckpoint,
  migrateCheckpoint,
  publishCheckpoint,
  recoverDisk,
} from "./workspace-disk.ts";

type Options = {
  directory: string;
  workspaceId: string;
  namePrefix?: string;
};

/** One bot-owned workspace; compute providers use disk or a bounded checkpoint projection. */
export class RuntimeWorkspace {
  private readonly checkpoint: BotWorkspace;
  private readonly options: Options;
  private container?: ContainerWorkspace;
  private containerUnavailable = false;
  private filesUnavailable?: string;
  private admitted = 0;
  private readonly views = new ModelConnectionGate();

  private constructor(checkpoint: BotWorkspace, options: Options) {
    this.checkpoint = checkpoint;
    this.options = options;
  }

  static async open(options: Options) {
    const checkpoint = await BotWorkspace.open(
      join(options.directory, "workspace", "checkpoint.sqlite"),
    );
    const workspace = new RuntimeWorkspace(checkpoint, options);
    try {
      if (checkpoint.settings().provider === "container") {
        // Reap the previous epoch even if stored settings lack acknowledgement
        // after an upgrade. Opening control state never starts a new container.
        workspace.container = await workspace.openContainer(
          checkpoint.settings(),
        );
        if (!checkpoint.settings().hostNetworkAcknowledged) {
          await workspace.container.close();
          workspace.container = undefined;
        }
      }
      if (!checkpoint.initialized()) {
        const target = await workspace.migrateFiles();
        const legacy = checkpoint.snapshot();
        checkpoint.adoptFiles(
          checkpoint.settings().provider === "just-bash"
            ? target === "root" &&
              legacy.some((entry) => entry.path !== "/workspace")
              ? legacy
              : await diskCheckpoint(
                  join(options.directory, "workspace", "files"),
                )
            : undefined,
        );
      } else if (checkpoint.settings().provider === "just-bash") {
        await recoverDisk(join(options.directory, "workspace"));
        await publishCheckpoint(
          join(options.directory, "workspace"),
          checkpoint.snapshot(),
        );
      }
      return workspace;
    } catch (error) {
      // A daemon outage must not prevent owner recovery or unrelated bots from
      // starting. No native capability is installed until the stale epoch is reaped.
      if (error instanceof ContainerRuntimeError) {
        workspace.container = undefined;
        workspace.containerUnavailable = true;
        return workspace;
      }
      if (
        error instanceof InputError &&
        error.status === 409 &&
        checkpoint.settings().provider === "just-bash"
      ) {
        workspace.filesUnavailable = error.message;
        return workspace;
      }
      await workspace.close();
      throw error;
    }
  }

  private async migrateFiles() {
    const directory = join(this.options.directory, "workspace");
    await recoverDisk(directory);
    let target = this.checkpoint.savedMigrationTarget();
    if (!target) {
      try {
        target = this.checkpoint.migrationTarget(
          (await readdir(join(directory, "files"))).length > 0,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error.code === "EACCES" || error.code === "EPERM")
        )
          throw new InputError(
            "Workspace files cannot be read with their current permissions. Preserve the files and restore access before retrying.",
            409,
          );
        throw error;
      }
    }
    await migrateCheckpoint(directory, this.checkpoint.snapshot(), target);
    return target;
  }

  private requireFiles() {
    if (this.filesUnavailable) throw new InputError(this.filesUnavailable, 409);
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
        this.admitted ||
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
        const directory = join(this.options.directory, "workspace");
        // openContainer fenced all native writers before either representation is read.
        const adopting = !this.checkpoint.initialized();
        const target = adopting ? await this.migrateFiles() : undefined;
        if (!adopting && before.provider === "just-bash")
          await publishCheckpoint(directory, this.checkpoint.snapshot());
        const entries =
          input.provider === "just-bash" &&
          (before.provider === "container" || adopting)
            ? target === "root" &&
              this.checkpoint
                .snapshot()
                .some((entry) => entry.path !== "/workspace")
              ? this.checkpoint.snapshot()
              : await diskCheckpoint(join(directory, "files"))
            : undefined;
        if (input.provider !== "container") await next?.close();
        const saved = adopting
          ? this.checkpoint.adoptFiles(entries, input)!
          : entries
            ? this.checkpoint.replaceFiles(entries, input)!
            : this.checkpoint.saveSettings(input);
        this.container = input.provider === "container" ? next : undefined;
        this.containerUnavailable = false;
        this.filesUnavailable = undefined;
        return saved;
      } catch (error) {
        await next?.close();
        this.container = undefined;
        if (before.provider === "container" && before.hostNetworkAcknowledged) {
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
    if (!this.settings().hostNetworkAcknowledged)
      throw new InputError(
        "Acknowledge host and local network access in this bot's Sandbox settings before using Container.",
        409,
      );
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
  execute(
    ...input: [...Parameters<BotWorkspace["execute"]>, (() => Promise<void>)?]
  ) {
    const [sessionId, operationId, command, signal, authorize] = input;
    if (this.settings().provider !== "just-bash")
      throw new InputError("Use the container coding tools for this bot.", 409);
    this.requireFiles();
    if (this.admitted >= 16)
      throw new InputError("Workspace queue is full. Retry later.", 409);
    this.admitted++;
    return this.views
      .run(async () => {
        this.requireFiles();
        await authorize?.();
        const result = await this.checkpoint.execute(
          sessionId,
          operationId,
          command,
          signal,
        );
        return result;
      })
      .finally(() => {
        this.admitted--;
      });
  }

  async putFile(path: string, bytes: Uint8Array) {
    this.requireFiles();
    if (this.admitted >= 16)
      throw new InputError("Workspace queue is full. Retry later.", 409);
    this.admitted++;
    return this.views
      .run(async () => {
        const container = this.selectedContainer();
        if (container) {
          const result = await container.putFile(path, bytes, context);
          if (!result.ok)
            throw new InputError(
              "Could not write workspace upload. Restore its upload folder and retry.",
              409,
            );
        } else {
          await this.checkpoint.putFile(path, bytes);
        }
      })
      .finally(() => {
        this.admitted--;
      });
  }

  async info(): Promise<SandboxInfo> {
    return this.views.run(async () => {
      const base = this.checkpoint.info();
      if (base.settings.provider !== "container")
        return {
          ...base,
          executions: { ...base.executions, admitted: this.admitted },
          providers: base.providers.map((provider) =>
            provider.id === "just-bash" && this.filesUnavailable
              ? { ...provider, available: false, reason: this.filesUnavailable }
              : provider,
          ),
        };
      const container = this.container;
      let fileBytes: number | null = null;
      let reason: string | null = null;
      if (
        !container &&
        (this.containerUnavailable || base.settings.hostNetworkAcknowledged)
      ) {
        reason =
          "Container runtime is unavailable. Restore the runtime, then save settings again or restart Raphie. Files were preserved.";
      } else if (container) {
        try {
          fileBytes = await container.usage(context);
        } catch {
          // Usage is auxiliary: even a missing image or full capacity must leave
          // persisted settings and provider recovery controls available.
          reason =
            "Container usage is unavailable. Check the runtime, image and container capacity, then retry. Saved settings remain available.";
        }
      }
      return {
        ...base,
        providers: base.providers.map((provider) =>
          provider.id === "container" && reason
            ? { ...provider, available: false, reason }
            : provider,
        ),
        provider: { id: "container", name: "Container", version: "native" },
        isolation: "container",
        capabilities: { network: true, hostFiles: false, nativeCode: true },
        revision: base.settings.revision,
        executions: {
          admitted: container?.admitted ?? 0,
          capacity: containerLimits.queued,
          runtimeConcurrency: containerLimits.concurrent,
        },
        usage: {
          fileBytes,
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
    this.requireFiles();
    if (this.settings().provider === "just-bash")
      return Promise.resolve(this.checkpoint.list(path));
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
    this.requireFiles();
    if (this.settings().provider === "just-bash")
      return Promise.resolve(this.checkpoint.download(path, revision));
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

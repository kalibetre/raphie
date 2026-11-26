import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai/models";
import { createModels } from "@earendil-works/pi-ai/models";
import type {
  Conversation,
  ConversationId,
  Extension,
  ModelRef,
} from "@earendil-works/pi-durable";
import {
  createRegistry,
  defineExtension,
  Harness,
} from "@earendil-works/pi-durable";
import { createToolSearchExtension } from "@earendil-works/pi-durable/tool-search";
import type {
  BotProfile,
  OwnerProfile,
  SaveSandboxSettings,
} from "@raphie/contracts";

import { ActorAuthority } from "../application/access/actors.ts";
import { Sessions } from "../application/sessions/operations.ts";
import {
  Activity,
  record,
} from "../domains/activity/infrastructure/pi-activity-journal.ts";
import type { McpTools } from "../domains/approvals/infrastructure/mcp-approval-gate.ts";
import { createMcpTools } from "../domains/approvals/infrastructure/mcp-approval-gate.ts";
import { deliveryWorkflow } from "../domains/approvals/infrastructure/pi-delivery-workflow.ts";
import { FileApprovalService } from "../domains/approvals/infrastructure/pi-file-approval-service.ts";
import {
  InputError,
  State,
} from "../domains/approvals/infrastructure/pi-file-approvals.ts";
import {
  ToolApprovals,
  ToolApprovalService,
} from "../domains/approvals/infrastructure/pi-tool-approvals.ts";
import {
  Asks,
  AskService,
  createAskTools,
} from "../domains/asks/infrastructure/pi-asks.ts";
import { Files } from "../domains/attachments/infrastructure/local-attachment-store.ts";
import {
  CardService,
  createCardTools,
} from "../domains/cards/infrastructure/pi-cards.ts";
import { isPrivateDestination } from "../domains/channels/domain/binding.ts";
import { ChannelBindings } from "../domains/channels/infrastructure/pi-bindings.ts";
import { PiChannelHome } from "../domains/channels/infrastructure/pi-home.ts";
import { chatFromHistory } from "../domains/conversations/domain/chat.ts";
import { compactionPolicy } from "../domains/conversations/domain/compaction.ts";
import { chatSummaries } from "../domains/conversations/infrastructure/chat-summary.ts";
import { removeHistory } from "../domains/conversations/infrastructure/history-removal.ts";
import {
  Chats,
  ChatService,
  chatWorkflow,
  watchJobRun,
} from "../domains/conversations/infrastructure/pi-conversation-service.ts";
import { Observations } from "../domains/conversations/infrastructure/pi-observations.ts";
import { newSessionId } from "../domains/conversations/infrastructure/session-id.ts";
import {
  DeliveryPlans,
  PiDeliveryQueue,
} from "../domains/delivery/infrastructure/pi-delivery-queue.ts";
import type { MemoryService } from "../domains/memory/application/ports.ts";
import { createMemoryTools } from "../domains/memory/infrastructure/pi-memory-tools.ts";
import { Jobs } from "../domains/schedules/infrastructure/bot-jobs.ts";
import { connectedServicesInstructions } from "../domains/settings/domain/connected-services.ts";
import {
  createSkillTools,
  createSkillWriter,
} from "../domains/skills/infrastructure/skill-tools.ts";
import { WorkspaceSkills } from "../domains/skills/infrastructure/workspace-skills.ts";
import { createWebSearchTools } from "../domains/web/infrastructure/web-search-tools.ts";
import {
  createWorkTools,
  WorkService,
} from "../domains/work/infrastructure/work-items.ts";
import { WorkRuns } from "../domains/work/infrastructure/work-runs.ts";
import { createContainerTools } from "../domains/workspaces/infrastructure/container-tools.ts";
import { createDocumentTools } from "../domains/workspaces/infrastructure/document-tools.ts";
import { RuntimeWorkspace } from "../domains/workspaces/infrastructure/runtime-workspace.ts";
import { createWorkspaceTools } from "../domains/workspaces/infrastructure/workspace-tools.ts";
import { traceSessions } from "../infrastructure/observability/session-tracing.ts";
import { PiClientQueries } from "../infrastructure/pi/client-queries.ts";
import {
  backupSqlite,
  openBunSqliteStorage,
} from "../infrastructure/storage/bun-sqlite.ts";
import { appDataIdentity } from "../infrastructure/workspace/app-data.ts";
import {
  noTelemetry,
  type Telemetry,
} from "../shared/application/telemetry.ts";
import { ModelConnectionGate } from "../shared/infrastructure/model-connection-gate.ts";

type Options = {
  containerNamePrefix?: "raphie-test";
  identity?: { id: string; directory: string; kind?: "fixture" };
  deferResume?: boolean;
  now?: () => number;
  botId?: string;
  memory?: MemoryService;
  directory: string;
  discordThreadId?: string;
  discordConnectionId?: string;
  approvalTtlMs?: number;
  /** How long a bot's question waits for the owner; an hour by default. */
  askTtlMs?: number;
  beforeEffectCommit?: () => Promise<void>;
  models?: Models;
  model?: ModelRef;
  modelConnectionGate?: ModelConnectionGate;
  mcp?: McpTools;
  mcpError?: boolean;
  telemetry?: Telemetry;
  /** Web requests the web_search tool makes; tests answer them without a network. */
  webFetch?: (input: string, init: RequestInit) => Promise<Response>;
};

export class Gateway {
  mcpConnections: McpTools[] = [];
  private toolSearch = createToolSearchExtension();

  install(extension: Extension) {
    this.registry.install(extension);
  }

  uninstall(extension: Extension) {
    this.registry.uninstall(extension);
  }

  private registry!: ReturnType<typeof createRegistry>;
  private managedMcp: ReturnType<typeof createMcpTools>[] = [];

  setMcp(connections: McpTools[]) {
    const extensions = connections.map((c) => createMcpTools(this, c));
    for (const extension of this.managedMcp) this.registry.uninstall(extension);
    for (const extension of extensions) this.registry.install(extension);
    this.managedMcp = extensions;
    this.mcpConnections = connections;
    if (connections.length) this.registry.install(this.toolSearch);
    else this.registry.uninstall(this.toolSearch);
  }

  readonly configurationGate: ModelConnectionGate;
  readonly actors: ActorAuthority;
  readonly home: PiChannelHome;
  readonly sessions: ReturnType<typeof traceSessions>;
  readonly telemetry: Telemetry;
  readonly models: Models;
  readonly queries: PiClientQueries;
  readonly deliveries: PiDeliveryQueue;
  files: Files;
  harness!: Harness;
  workspace!: RuntimeWorkspace;
  /** This bot's skills, kept in its workspace. */
  skills!: WorkspaceSkills;
  root!: Conversation;
  options: Options;
  workflow: ReturnType<typeof deliveryWorkflow>;
  fileApprovals: FileApprovalService;
  chats: ChatService;
  toolApprovals: ToolApprovalService;
  asks: AskService;
  cards: CardService;
  work: WorkService;
  workRuns: WorkRuns;
  observations: Observations;

  private constructor(options: Options) {
    this.options = options;
    this.actors = new ActorAuthority(options.botId ?? "default");
    this.home = new PiChannelHome(this, this.actors);
    this.configurationGate =
      options.modelConnectionGate ?? new ModelConnectionGate();
    this.telemetry = options.telemetry ?? noTelemetry;
    this.files = new Files(
      join(options.directory, "files"),
      {
        putFile: (path, bytes) => this.workspace.putFile(path, bytes),
      },
      this.configurationGate,
    );
    this.workflow = deliveryWorkflow(
      this.files,
      options.discordThreadId ?? null,
      options.beforeEffectCommit,
    );
    this.fileApprovals = new FileApprovalService(this);
    this.models = options.models ?? createModels();
    this.chats = new ChatService(
      this,
      this.models,
      options.model,
      this.configurationGate,
      options.memory,
      this.files,
    );
    this.chats.homeAvailable = (address) => this.home.available(address);
    this.toolApprovals = new ToolApprovalService(this);
    this.asks = new AskService(this);
    this.cards = new CardService(this);
    this.work = new WorkService(this);
    this.observations = new Observations(this);
    this.deliveries = new PiDeliveryQueue(this);
    this.queries = new PiClientQueries(this);
    this.sessions = traceSessions(
      new Sessions(
        this.actors,
        this.chats,
        this.toolApprovals,
        this.fileApprovals,
      ),
      this.telemetry,
    );
    this.workRuns = new WorkRuns({
      root: () => this.root,
      submit: (input) =>
        this.sessions.submitWork(this.actors.establish("web"), input),
      post: (input) => this.chats.postWorkResult(input),
      turn: (turnId) => this.chats.turn(turnId),
      stop: (sessionId) => this.chats.control(sessionId, "stop"),
    });
    this.work.runs = this.workRuns;
  }

  static async open(options: Options) {
    options = {
      ...options,
      identity: options.identity ?? (await appDataIdentity(options.directory)),
    };
    const app = new Gateway(options);
    try {
      return await Gateway.initialize(app, options);
    } catch (error) {
      await app.close().catch(() => {});
      throw error;
    }
  }

  private static async initialize(app: Gateway, options: Options) {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const registry = createRegistry();
    app.registry = registry;
    registry.install(
      defineExtension({
        name: "raphie.gateway",
        tasks: [app.workflow, chatWorkflow, watchJobRun],
      }),
    );
    if (options.memory)
      registry.install(
        createMemoryTools(options.memory, async (conversationId) => {
          const state = await app.chats.state();
          const session = state.conversations.find(
            (c) => c.id === conversationId,
          );
          const turn = state.turns.findLast(
            (t) =>
              t.conversationId === conversationId &&
              t.status === "pending" &&
              !t.queueMode,
          );
          return session && turn
            ? {
                sessionId: session.sessionId,
                turnId: turn.id,
                eventTime: turn.createdAt,
              }
            : null;
        }),
      );
    registry.install(createWebSearchTools(() => app.models, options.webFetch));
    registry.install(chatSummaries);
    registry.install(createWorkTools(app.workRuns));
    registry.install(app.workRuns.extension());
    registry.install(createAskTools(app.asks));
    registry.install(
      createCardTools(app.cards, () => app.chats.owner?.().timeZone ?? ""),
    );
    if (options.mcp) {
      registry.install(createMcpTools(app, options.mcp));
      app.mcpConnections = [options.mcp];
    }
    app.harness = await Harness.open(
      await openBunSqliteStorage(join(options.directory, "gateway.sqlite")),
      {
        registry,
        now: options.now,
        models: app.models,
        settings: {
          followUpMode: "one-at-a-time",
          stream: { timeoutMs: 120_000 },
          retry: { enabled: true, maxRetries: 1 },
          // Read at every request, so models added later get theirs too.
          get compaction() {
            return { modelOverrides: compactionOverrides(app.models) };
          },
        },
      },
      context,
    );
    app.root = await app.harness.root(context);
    app.workspace = await RuntimeWorkspace.open({
      directory: options.directory,
      workspaceId: options.identity!.id,
      namePrefix: options.containerNamePrefix,
    });
    app.installWorkspaceTools();
    app.skills = new WorkspaceSkills(app.workspace);
    registry.install(createSkillTools(app.skills));
    // Read at each call: the owner can turn it off between turns.
    registry.install(
      createSkillWriter(
        app.skills,
        () => app.chats.personality?.().selfUpdates.skills ?? false,
      ),
    );
    app.chats.services = () =>
      connectedServicesInstructions(
        app.mcpConnections.map((connection) => ({
          name:
            connection.name ?? connection.client.server?.name ?? "MCP server",
          instructions: connection.client.instructions,
          apps: connection.client.apps,
        })),
      );
    app.chats.skills = {
      instructions: (canWrite) => app.skills.instructions(canWrite),
      refresh: () => app.skills.refresh(),
      invoke: (text) => app.skills.invoke(text),
    };
    const previousChats = await app.harness.snapshot(Chats, context);
    const previousModels = new Map<number, ModelRef>();
    for (const session of previousChats?.conversations ?? []) {
      if (session.model) continue;
      const conversation = await app.harness.conversation(
        session.id as ConversationId,
        context,
      );
      const model =
        (await conversation?.agent(context))?.model ?? options.model;
      if (model) previousModels.set(session.id, model);
    }
    await app.root.commit(async (tx) => {
      const state = await tx.doc(State);
      // Sending may have succeeded before the process died. Never blindly resend it.
      for (const delivery of state.deliveries)
        if (delivery.status === "sending") {
          delivery.status = "uncertain";
          delivery.error =
            "Interrupted during delivery; check Discord before retrying.";
        }
      const chats = await tx.doc(Chats);
      // Add public identifiers once, in the same transaction as recovery.
      for (const conversation of chats.conversations) {
        if (!conversation.model && previousModels.has(conversation.id))
          conversation.model = previousModels.get(conversation.id)!;
        if (!conversation.sessionId)
          conversation.sessionId = newSessionId(conversation.createdAt);
      }
      const bindings = (await tx.doc(ChannelBindings)).bindings;
      // Backfill only persisted associations, never the current default channel.
      for (const conversation of chats.conversations) {
        const legacy = conversation as typeof conversation & {
          discordThreadId?: string | null;
        };
        if (legacy.discordThreadId) {
          const destination = {
            provider: "discord" as const,
            owner: "owner" as const,
            connectionId: options.discordConnectionId ?? "legacy-discord",
            conversation: legacy.discordThreadId,
          };
          if (
            !bindings.some(
              (b) =>
                b.sessionId === conversation.sessionId &&
                b.connectionId === destination.connectionId &&
                b.conversation === destination.conversation,
            )
          )
            bindings.push({
              ...destination,
              sessionId: conversation.sessionId,
            });
          for (const turn of chats.turns.filter(
            (t) => t.conversationId === conversation.id,
          ))
            if (turn.replyTo === undefined)
              turn.replyTo = turn.source === "discord" ? destination : null;
        }
        Reflect.deleteProperty(conversation, "discordThreadId");
      }
      for (const delivery of chats.deliveries)
        if (delivery.status === "sending") delivery.status = "uncertain";
      // Bots from before chats keep their latest conversation from an app or
      // a private channel chat as the chat, and every private channel chat
      // joins it.
      if (!chats.conversations.some((c) => c.chat)) {
        const chat = chatFromHistory(chats.conversations, chats.turns);
        if (chat) chat.chat = true;
      }
      // Nothing is archived any more.
      for (const conversation of chats.conversations)
        Reflect.deleteProperty(conversation, "archivedAt");
      // Jobs from before chats named a session of their own.
      for (const job of (await tx.doc(Jobs)).items)
        Reflect.deleteProperty(job, "sessionId");
      const chat = chats.conversations.find((c) => c.chat);
      if (chat)
        for (const binding of bindings)
          if (isPrivateDestination(binding)) binding.sessionId = chat.sessionId;
      const toolApprovals = await tx.doc(ToolApprovals);
      // Created up front, as the approvals are, so a tool waiting on a
      // question watches a doc that already exists.
      const asks = await tx.doc(Asks);
      const legacyConnection = options.discordConnectionId ?? "legacy-discord";
      for (const delivery of [
        ...state.deliveries,
        ...chats.deliveries,
        ...toolApprovals.deliveries,
      ])
        delivery.connectionId ??= legacyConnection;
      for (const approval of state.approvals)
        approval.connectionId ??= legacyConnection;
      for (const approval of toolApprovals.approvals)
        if (approval.replyTo === undefined) {
          const delivery = toolApprovals.deliveries.find(
            (d) => d.approvalId === approval.id,
          );
          approval.replyTo = delivery
            ? {
                provider: "discord",
                owner: "owner",
                connectionId: delivery.connectionId!,
                conversation: delivery.threadId,
              }
            : null;
        }
      for (const plan of (await tx.doc(DeliveryPlans)).plans) {
        plan.connectionId ??= legacyConnection;
        for (const operation of plan.operations)
          if (operation.status === "sending") operation.status = "uncertain";
      }
      const journal = await tx.doc(Activity);
      record(
        journal,
        "runtime.started",
        "Runtime started; durable state recovered",
      );
      record(
        journal,
        options.mcp
          ? "mcp.connected"
          : options.mcpError
            ? "mcp.failed"
            : "mcp.disabled",
        options.mcp
          ? "MCP tools connected"
          : options.mcpError
            ? "MCP connection failed"
            : "MCP is not configured",
        {
          details: {
            server: options.mcp?.client.server,
            toolCount: options.mcp?.client.tools.length ?? 0,
          },
        },
      );
      for (const turn of chats.turns.filter(
        (t) => t.status === "pending" && !t.queueMode,
      ))
        record(journal, "run.recovered", "Unfinished run recovered", {
          conversationId: turn.conversationId,
          runId: turn.id,
        });
      for (const item of toolApprovals.approvals)
        if (item.execution === "running") {
          item.execution = "uncertain";
          record(
            journal,
            "action.uncertain",
            "Interrupted action requires inspection",
            { conversationId: item.conversationId, operationId: item.id },
          );
        }
      for (const delivery of [...toolApprovals.deliveries, ...asks.deliveries])
        if (delivery.status === "sending") delivery.status = "uncertain";
    }, context);
    // Sessions from before chats go, after a copy of the bot's storage. A
    // failure keeps them all, and the bot starts anyway.
    const database = join(options.directory, "gateway.sqlite");
    try {
      await removeHistory(
        app,
        () =>
          backupSqlite(
            database,
            join(
              options.directory,
              "backups",
              `before-one-chat-${Date.now()}.sqlite`,
            ),
          ),
        context,
      );
    } catch (error) {
      await app.root.commit(async (tx) => {
        record(
          await tx.doc(Activity),
          "sessions.cleanup_failed",
          "Sessions from before chats were kept: backing up or removing them failed",
          { details: { error: String(error) } },
        );
      }, context);
    }
    for (const conversation of (await app.chats.state()).conversations)
      await app.observations.attach(conversation.id);
    if (!options.deferResume) app.harness.resume();
    return app;
  }

  async state() {
    return (await this.harness.snapshot(State, context))!;
  }

  private installWorkspaceTools() {
    const session = async (conversationId: number) => {
      const state = await this.chats.state();
      const selected = state.conversations.find((s) => s.id === conversationId);
      return selected &&
        state.turns.some(
          (t) =>
            t.conversationId === conversationId &&
            t.status === "pending" &&
            !t.queueMode,
        )
        ? selected.sessionId
        : undefined;
    };
    this.registry.install(
      this.workspace.settings().provider === "container"
        ? createContainerTools(async (conversationId, operationId) => {
            if (!(await session(conversationId)))
              throw new InputError(
                "Workspace execution requires an active session turn.",
                409,
              );
            return this.workspace.env(operationId);
          }, this.toolApprovals)
        : createWorkspaceTools(this.workspace, session, this.toolApprovals),
    );
    this.registry.install(createDocumentTools(this.workspace, session));
  }

  async saveSandboxSettings(input: SaveSandboxSettings) {
    const saved = await this.workspace.saveSettings(input);
    this.installWorkspaceTools();
    return saved;
  }

  /** Who the owner is, read at the start of every turn. */
  /** The bot's usable skills that are on: each can be invoked by name. */
  async skillCommands() {
    return (await this.skills.list())
      .filter((skill) => skill.enabled && !skill.problem)
      .map(({ name, description }) => ({ name, description }));
  }

  setOwner(read: () => OwnerProfile) {
    this.chats.owner = read;
  }

  setPersonality(
    read: () => Pick<
      BotProfile,
      | "name"
      | "description"
      | "personality"
      | "replyStyle"
      | "revision"
      | "selfUpdates"
      | "instructions"
    >,
  ) {
    this.chats.personality = read;
  }

  async close() {
    try {
      await this.observations.close();
      await this.harness?.close(context);
    } finally {
      await this.workspace?.close();
    }
  }

  accept(...args: Parameters<FileApprovalService["accept"]>) {
    return this.fileApprovals.accept(...args);
  }

  decide(...args: Parameters<FileApprovalService["decide"]>) {
    return this.fileApprovals.decide(...args);
  }

  authorize(actor: string) {
    if (actor !== "owner") throw new InputError("Not authorized.", 403);
  }

  claimDelivery() {
    return this.fileApprovals.claimDelivery();
  }

  settleDelivery(...args: Parameters<FileApprovalService["settleDelivery"]>) {
    return this.fileApprovals.settleDelivery(...args);
  }
}

/** Each model's summary thresholds, scaled to its context window. */
function compactionOverrides(models: Models) {
  return Object.fromEntries(
    models
      .getModels()
      .filter((model) => model.contextWindow > 0)
      .map((model) => [
        `${model.provider}/${model.id}`,
        compactionPolicy(model.contextWindow),
      ]),
  );
}

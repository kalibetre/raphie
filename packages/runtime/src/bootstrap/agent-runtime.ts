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
import type { BotProfile } from "@raphie/contracts";

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
import { Files } from "../domains/attachments/infrastructure/local-attachment-store.ts";
import { ChannelBindings } from "../domains/channels/infrastructure/pi-bindings.ts";
import {
  Chats,
  ChatService,
  chatWorkflow,
} from "../domains/conversations/infrastructure/pi-conversation-service.ts";
import { Observations } from "../domains/conversations/infrastructure/pi-observations.ts";
import { newSessionId } from "../domains/conversations/infrastructure/session-id.ts";
import {
  DeliveryPlans,
  PiDeliveryQueue,
} from "../domains/delivery/infrastructure/pi-delivery-queue.ts";
import type { MemoryService } from "../domains/memory/application/ports.ts";
import { createMemoryTools } from "../domains/memory/infrastructure/pi-memory-tools.ts";
import { traceSessions } from "../infrastructure/observability/session-tracing.ts";
import { PiClientQueries } from "../infrastructure/pi/client-queries.ts";
import { openBunSqliteStorage } from "../infrastructure/storage/bun-sqlite.ts";
import {
  noTelemetry,
  type Telemetry,
} from "../shared/application/telemetry.ts";
import { ModelConnectionGate } from "../shared/infrastructure/model-connection-gate.ts";

type Options = {
  deferResume?: boolean;
  now?: () => number;
  botId?: string;
  memory?: MemoryService;
  directory: string;
  discordThreadId?: string;
  discordConnectionId?: string;
  approvalTtlMs?: number;
  beforeEffectCommit?: () => Promise<void>;
  models?: Models;
  model?: ModelRef;
  modelConnectionGate?: ModelConnectionGate;
  mcp?: McpTools;
  mcpError?: boolean;
  telemetry?: Telemetry;
};

export class Gateway {
  mcpConnections: McpTools[] = [];
  private toolSearch = createToolSearchExtension();

  install(extension: Extension) {
    this.registry.install(extension);
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
  readonly sessions: ReturnType<typeof traceSessions>;
  readonly telemetry: Telemetry;
  readonly models: Models;
  readonly queries: PiClientQueries;
  readonly deliveries: PiDeliveryQueue;
  files: Files;
  harness!: Harness;
  root!: Conversation;
  options: Options;
  workflow: ReturnType<typeof deliveryWorkflow>;
  fileApprovals: FileApprovalService;
  chats: ChatService;
  toolApprovals: ToolApprovalService;
  observations: Observations;

  private constructor(options: Options) {
    this.options = options;
    this.actors = new ActorAuthority(options.botId ?? "default");
    this.configurationGate =
      options.modelConnectionGate ?? new ModelConnectionGate();
    this.telemetry = options.telemetry ?? noTelemetry;
    this.files = new Files(join(options.directory, "files"));
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
    );
    this.toolApprovals = new ToolApprovalService(this);
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
  }

  static async open(options: Options) {
    const app = new Gateway(options);
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const registry = createRegistry();
    app.registry = registry;
    registry.install(
      defineExtension({
        name: "raphie.gateway",
        tasks: [app.workflow, chatWorkflow],
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
              t.conversationId === conversationId && t.status === "pending",
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
        },
      },
      context,
    );
    app.root = await app.harness.root(context);
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
      const toolApprovals = await tx.doc(ToolApprovals);
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
      for (const turn of chats.turns.filter((t) => t.status === "pending"))
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
      for (const delivery of toolApprovals.deliveries)
        if (delivery.status === "sending") delivery.status = "uncertain";
    }, context);
    for (const conversation of (await app.chats.state()).conversations)
      await app.observations.attach(conversation.id);
    if (!options.deferResume) app.harness.resume();
    return app;
  }

  async state() {
    return (await this.harness.snapshot(State, context))!;
  }

  setPersonality(
    read: () => Pick<BotProfile, "name" | "description" | "soul" | "revision">,
  ) {
    this.chats.personality = read;
  }

  async close() {
    await this.observations.close();
    await this.harness.close(context);
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

import { Hono } from "hono";

import { streamSnapshots } from "../domains/activity/presentation/http/events.ts";
import { approvalRoutes } from "../domains/approvals/presentation/http/routes.ts";
import { attachmentRoutes } from "../domains/attachments/presentation/http/routes.ts";
import { conversationRoutes } from "../domains/conversations/presentation/http/routes.ts";
import type { TraceReader } from "../domains/diagnostics/application/trace-reader.ts";
import { noTraces } from "../domains/diagnostics/application/trace-reader.ts";
import { diagnosticsRoutes } from "../domains/diagnostics/presentation/http/routes.ts";
import type { MemoryService } from "../domains/memory/application/ports.ts";
import { memoryRoutes } from "../domains/memory/presentation/http/routes.ts";
import type { BotJobs } from "../domains/schedules/infrastructure/bot-jobs.ts";
import { jobRoutes } from "../domains/schedules/presentation/http/routes.ts";
import type { SettingsService } from "../domains/settings/application/ports.ts";
import type { BotMcp } from "../domains/settings/infrastructure/bot-mcp.ts";
import { mcpRoutes } from "../domains/settings/presentation/http/mcp-routes.ts";
import { settingsRoutes } from "../domains/settings/presentation/http/routes.ts";
import { workspaceRoutes } from "../domains/workspaces/presentation/http/routes.ts";
import { clientRoutes } from "../infrastructure/http/client-routes.ts";
import { snapshot } from "../infrastructure/pi/workspace-snapshot.ts";
import { InputError } from "../shared/application/input-error.ts";
import type { Gateway } from "./agent-runtime.ts";

export type RuntimeHttpOptions = {
  mcp?: BotMcp;
  jobs?: BotJobs;
  discordConfigured?: boolean;
  diagnostics?: TraceReader;
  settings?: SettingsService;
  memory?: MemoryService;
};

/** Every route receives only one bot's runtime and cannot resolve its peers. */
export function runtimeRoutes(
  runtime: Gateway,
  options: RuntimeHttpOptions = {},
) {
  const app = new Hono();
  app.route(
    "/api/workspace",
    workspaceRoutes(runtime.workspace, (input) =>
      runtime.configurationGate.run(async () => {
        if (
          (await runtime.chats.state()).turns.some(
            (turn) => turn.status === "pending",
          )
        )
          throw new InputError(
            "Wait for this bot's active turns to finish before changing sandbox settings.",
            409,
          );
        return runtime.workspace.saveSettings(input);
      }),
    ),
  );
  if (options.mcp) app.route("/api/mcp", mcpRoutes(options.mcp));
  if (options.jobs) app.route("/api/jobs", jobRoutes(options.jobs));
  // The outer host owns sanitized transport error responses.
  app.onError((error) => {
    throw error;
  });
  if (options.memory) app.route("/api/memory", memoryRoutes(options.memory));
  if (options.settings)
    app.route("/api/settings", settingsRoutes(options.settings));
  app.get("/api/chats", async (c) => c.json(await snapshot(runtime)));
  app.get("/api/events", (c) => streamSnapshots(c, () => snapshot(runtime)));
  const owner = runtime.actors.establish("web");
  app.route("/api", clientRoutes(runtime.queries, owner));
  app.route(
    "/api/diagnostics",
    diagnosticsRoutes(options.diagnostics ?? noTraces),
  );
  app.route("/api", conversationRoutes(runtime.sessions, owner));
  app.route(
    "/api",
    approvalRoutes(
      runtime.toolApprovals,
      runtime,
      runtime.files,
      options.discordConfigured ?? false,
      runtime.sessions,
      owner,
    ),
  );
  app.route("/api", attachmentRoutes(runtime.files, runtime));
  return app;
}

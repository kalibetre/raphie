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
import type { SettingsService } from "../domains/settings/application/ports.ts";
import { settingsRoutes } from "../domains/settings/presentation/http/routes.ts";
import { clientRoutes } from "../infrastructure/http/client-routes.ts";
import { snapshot } from "../infrastructure/pi/workspace-snapshot.ts";
import type { Gateway } from "./agent-runtime.ts";

export type RuntimeHttpOptions = {
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

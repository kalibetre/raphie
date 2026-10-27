import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { Effect } from "effect";

import {
  attemptId,
  redact,
} from "../domains/activity/infrastructure/pi-activity-journal.ts";
import { openLocalOtlp } from "../domains/diagnostics/infrastructure/local-otlp.ts";
import { RuntimeMemory } from "../domains/memory/infrastructure/runtime-memory.ts";
import { BackendSettings } from "../domains/settings/infrastructure/runtime-settings.ts";
import { legacyMcpConfig } from "../infrastructure/mcp/legacy-config.ts";
import { createTelemetry } from "../infrastructure/observability/effect-telemetry.ts";
import { switchableTelemetry } from "../infrastructure/observability/telemetry-switch.ts";
import { ownAppData } from "../infrastructure/workspace/app-data-owner.ts";
import {
  appDataDirectory,
  appDataIdentity,
} from "../infrastructure/workspace/app-data.ts";
import { Gateway } from "./agent-runtime.ts";
import { BotHost } from "./bot-host.ts";
import { startServer } from "./http-server.ts";

const resource = <A>(
  open: () => Promise<A>,
  close: (value: A) => Promise<unknown>,
) =>
  Effect.acquireRelease(Effect.tryPromise(open), (value) =>
    Effect.promise(() => close(value)),
  );

let lifecycle: "starting" | "running" | "stopping" = "starting";

const program = Effect.gen(function* () {
  const legacyMcp = legacyMcpConfig(process.env);
  const directory = appDataDirectory(
    fileURLToPath(new URL("../../../../", import.meta.url)),
    process.env.DATA_DIRECTORY,
  );
  yield* resource(
    () => ownAppData(directory),
    async (owner) => owner.close(),
  );
  const identity = yield* Effect.tryPromise(() => appDataIdentity(directory));
  const collector = yield* resource(
    () =>
      openLocalOtlp(
        resolve(directory, "traces.sqlite"),
        process.env.OTEL_SERVICE_NAME,
      ),
    (collector) => collector.close(),
  );
  const exporter = yield* resource(
    () =>
      createTelemetry({
        endpoint: collector.endpoint,
        serviceName: process.env.OTEL_SERVICE_NAME,
        attemptId,
      }),
    (telemetry) => telemetry.close(),
  );
  const models = createModels();
  const provider = openrouterProvider();
  models.setProvider(provider);
  const settings = yield* resource(
    () =>
      BackendSettings.open(resolve(directory, "settings.sqlite"), {
        models,
        defaultModel: process.env.RAPHIE_MODEL ?? "anthropic/claude-haiku-5.5",
      }),
    async (settings) => settings.close(),
  );
  const memory = yield* resource(
    async () =>
      new RuntimeMemory(
        resolve(directory, "memory.sqlite"),
        settings,
        settings.connectionGate,
      ),
    async (memory) => memory.close(),
  );
  const telemetry = switchableTelemetry(
    exporter,
    () => settings.telemetryEnabled,
  );
  const port = Number(process.env.PORT ?? 4316);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT.");
  const webOrigin = process.env.RAPHIE_WEB_ORIGIN ?? "http://127.0.0.1:4320";
  const app = yield* resource(
    () =>
      telemetry.run("runtime.start", {}, () =>
        Gateway.open({
          deferResume: true,
          identity,
          directory,
          telemetry,
          models,
          model: settings.model,
          modelConnectionGate: settings.connectionGate,
          memory,
        }),
      ),
    (app) => app.close(),
  );
  settings.onChange = () => {
    app.chats.model = settings.model;
  };
  memory.isBusy = settings.isBusy = async () =>
    (await app.chats.state()).turns.some((turn) => turn.status === "pending");
  const bots = yield* resource(
    () =>
      BotHost.open(directory, { gateway: app, settings, memory }, undefined, {
        legacyMcp,
      }),
    (host) => host.close(),
  );
  const stop = yield* Effect.acquireRelease(
    Effect.sync(() => new AbortController()),
    (stop) => Effect.sync(() => stop.abort()),
  );
  const http = yield* resource(
    () =>
      startServer(app, {
        port,
        webOrigin,
        diagnostics: collector.traces,
        settings,
        memory,
        bots,
      }),
    (http) => http.close(),
  );
  lifecycle = "running";
  console.log(
    `Raphie runtime: ${http.url}\nRaphie web: ${webOrigin}\nApp data: ${identity.directory} (${identity.id})`,
  );
  yield* Effect.tryPromise(
    () =>
      new Promise<void>((done) => {
        const finish = () => {
          lifecycle = "stopping";
          process.off("SIGINT", finish);
          process.off("SIGTERM", finish);
          stop.abort();
          done();
        };
        process.once("SIGINT", finish);
        process.once("SIGTERM", finish);
      }),
  );
}).pipe(Effect.scoped);

Effect.runPromise(program).catch((error) => {
  const message =
    lifecycle === "starting"
      ? "Raphie could not start."
      : lifecycle === "stopping"
        ? "Raphie could not shut down cleanly."
        : "Raphie runtime failed.";
  console.error(message, redact({ message: String(error) }));
  process.exitCode = 1;
});

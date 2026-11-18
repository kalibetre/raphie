import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { Effect } from "effect";

import { webOrigins } from "../../../../shared/web-origins.ts";
import {
  attemptId,
  redact,
} from "../domains/activity/infrastructure/pi-activity-journal.ts";
import { openLocalOtlp } from "../domains/diagnostics/infrastructure/local-otlp.ts";
import { RuntimeMemory } from "../domains/memory/infrastructure/runtime-memory.ts";
import { CredentialStoreError } from "../domains/settings/infrastructure/credential-cipher.ts";
import { assertKeyFileOutsideData } from "../domains/settings/infrastructure/file-credential-key-store.ts";
import { BackendSettings } from "../domains/settings/infrastructure/runtime-settings.ts";
import { legacyMcpConfig } from "../infrastructure/mcp/legacy-config.ts";
import { createTelemetry } from "../infrastructure/observability/effect-telemetry.ts";
import { switchableTelemetry } from "../infrastructure/observability/telemetry-switch.ts";
import { ownAppData } from "../infrastructure/workspace/app-data-owner.ts";
import {
  appDataDirectory,
  appDataIdentity,
} from "../infrastructure/workspace/app-data.ts";
import { botTelemetry } from "../shared/application/telemetry.ts";
import { Gateway } from "./agent-runtime.ts";
import { BotHost } from "./bot-host.ts";
import { startServer } from "./http-server.ts";

/** A timestamped line in the service log, so a slow stop can be read back. */
const logged = (message: string) =>
  console.log(`${new Date().toISOString()} ${message}`);

const seconds = (since: number) =>
  `${((performance.now() - since) / 1000).toFixed(1)}s`;

/** Opened at start, closed at stop; a close that takes a second or more is logged by `name`. */
const resource = <A>(
  name: string,
  open: () => Promise<A>,
  close: (value: A) => Promise<unknown>,
) =>
  Effect.acquireRelease(Effect.tryPromise(open), (value) =>
    Effect.promise(async () => {
      const started = performance.now();
      try {
        return await close(value);
      } finally {
        if (performance.now() - started >= 1000)
          logged(`Raphie runtime: closing ${name} took ${seconds(started)}`);
      }
    }),
  );

let lifecycle: "starting" | "running" | "stopping" = "starting";
let stoppingAt = 0;

const program = Effect.gen(function* () {
  const legacyMcp = legacyMcpConfig(process.env);
  const directory = appDataDirectory(
    fileURLToPath(new URL("../../../../", import.meta.url)),
    process.env.DATA_DIRECTORY,
    Bun.isStandaloneExecutable,
  );
  const keyFile = process.env.RAPHIE_CREDENTIAL_KEY_FILE;
  if (keyFile !== undefined)
    try {
      assertKeyFileOutsideData(keyFile, directory);
    } catch (error) {
      console.error((error as Error).message);
      throw error;
    }
  yield* resource(
    "app data",
    () => ownAppData(directory),
    async (owner) => owner.close(),
  );
  const identity = yield* Effect.tryPromise(() => appDataIdentity(directory));
  const collector = yield* resource(
    "trace collector",
    () =>
      openLocalOtlp(
        resolve(directory, "traces.sqlite"),
        process.env.OTEL_SERVICE_NAME,
      ),
    (collector) => collector.close(),
  );
  const exporter = yield* resource(
    "telemetry",
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
    "settings",
    () =>
      BackendSettings.open(resolve(directory, "settings.sqlite"), {
        models,
        defaultModel: process.env.RAPHIE_MODEL ?? "anthropic/claude-haiku-5.5",
      }).catch((error: unknown) => {
        if (error instanceof CredentialStoreError) console.error(error.message);
        throw error;
      }),
    async (settings) => settings.close(),
  );
  const memory = yield* resource(
    "memory",
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
    "default bot",
    () =>
      telemetry.run("runtime.start", {}, () =>
        Gateway.open({
          deferResume: true,
          identity,
          directory,
          telemetry: botTelemetry(telemetry, "default"),
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
    "bots",
    () =>
      BotHost.open(directory, { gateway: app, settings, memory }, undefined, {
        legacyMcp,
        telemetry,
      }),
    (host) => host.close(),
  );
  const stop = yield* Effect.acquireRelease(
    Effect.sync(() => new AbortController()),
    (stop) => Effect.sync(() => stop.abort()),
  );
  const http = yield* resource(
    "HTTP server",
    () =>
      startServer(app, {
        port,
        webOrigin,
        webOrigins: webOrigins(
          webOrigin,
          Number(process.env.RAPHIE_WEB_PORT ?? 4320),
          process.env.RAPHIE_WEB_ALLOWED_ORIGINS,
        ),
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
        const finish = (signal: string) => {
          lifecycle = "stopping";
          stoppingAt = performance.now();
          logged(`Raphie runtime stopping (${signal})`);
          process.off("SIGINT", finish);
          process.off("SIGTERM", finish);
          // A signal that follows within seconds is the same stop (Ctrl-C
          // reaches the whole process group, and the parent passes it on):
          // the shutdown goes on. One after that stops Raphie at once.
          const again = (signal: string) => {
            if (performance.now() - stoppingAt < 5000) return;
            logged(`Raphie runtime stopping now (${signal})`);
            process.exit(1);
          };
          process.on("SIGINT", again);
          process.on("SIGTERM", again);
          stop.abort();
          done();
        };
        process.once("SIGINT", finish);
        process.once("SIGTERM", finish);
      }),
  );
}).pipe(Effect.scoped);

Effect.runPromise(program).then(
  () => {
    if (lifecycle === "stopping")
      logged(`Raphie runtime stopped after ${seconds(stoppingAt)}`);
  },
  (error) => {
    const message =
      lifecycle === "starting"
        ? "Raphie could not start."
        : lifecycle === "stopping"
          ? "Raphie could not shut down cleanly."
          : "Raphie runtime failed.";
    console.error(message, redact({ message: String(error) }));
    process.exitCode = 1;
  },
);

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
import { BackendSettings } from "../domains/settings/infrastructure/runtime-settings.ts";
import {
  createDiscordBridge,
  resolveDiscordThread,
} from "../infrastructure/discord/bridge.ts";
import { connectMcp, mcpConfig } from "../infrastructure/mcp/client.ts";
import { createTelemetry } from "../infrastructure/observability/effect-telemetry.ts";
import { switchableTelemetry } from "../infrastructure/observability/telemetry-switch.ts";
import { Gateway } from "./agent-runtime.ts";
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
  const directory = resolve(
    fileURLToPath(new URL("../../../../", import.meta.url)),
    process.env.DATA_DIRECTORY ?? ".data",
  );
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
        environmentKey: process.env.OPENROUTER_API_KEY,
        defaultModel: process.env.RAPHIE_MODEL ?? "anthropic/claude-haiku-5.5",
      }),
    async (settings) => settings.close(),
  );
  const telemetry = switchableTelemetry(
    exporter,
    () => settings.telemetryEnabled,
  );
  const discordEnabled = process.env.RAPHIE_DISCORD_ENABLED === "true";
  const keys = [
    "DISCORD_BOT_TOKEN",
    "DISCORD_APPLICATION_ID",
    "DISCORD_PUBLIC_KEY",
    "DISCORD_OWNER_ID",
    "DISCORD_CHANNEL_ID",
  ];
  const configured = discordEnabled
    ? keys.filter((key) => process.env[key])
    : [];
  if (configured.length && configured.length !== keys.length)
    throw new Error("Set all five Discord values, or leave all unset.");
  const port = Number(process.env.PORT ?? 4316);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT.");
  const webOrigin = process.env.RAPHIE_WEB_ORIGIN ?? "http://127.0.0.1:4320";
  const channelId = discordEnabled ? process.env.DISCORD_CHANNEL_ID : undefined;
  const threadId = channelId
    ? yield* Effect.tryPromise(() =>
        resolveDiscordThread({
          botToken: process.env.DISCORD_BOT_TOKEN!,
          channelId,
          guildId: process.env.DISCORD_GUILD_ID,
        }),
      )
    : undefined;
  const config = mcpConfig(process.env);
  let mcpError = false;
  const mcp = config
    ? yield* resource(
        async () => {
          try {
            return await connectMcp(config);
          } catch {
            mcpError = true;
            console.error(
              "MCP connection failed. Check configuration and restart.",
            );
            return undefined;
          }
        },
        async (client) => {
          await client?.close();
        },
      )
    : undefined;
  const app = yield* resource(
    () =>
      telemetry.run("runtime.start", {}, () =>
        Gateway.open({
          directory,
          discordThreadId: threadId,
          discordConnectionId: process.env.DISCORD_APPLICATION_ID,
          telemetry,
          models,
          model: settings.model,
          modelConnectionGate: settings.connectionGate,
          mcpError,
          mcp: mcp
            ? {
                client: mcp,
                identity: new Bun.CryptoHasher("sha256")
                  .update(JSON.stringify(config))
                  .digest("hex"),
                documentationTools:
                  mcp.server?.name === "executor" ? ["skills"] : [],
              }
            : undefined,
        }),
      ),
    (app) => app.close(),
  );
  settings.onChange = () => {
    app.chats.model = settings.model;
  };
  settings.isBusy = async () =>
    (await app.chats.state()).turns.some((turn) => turn.status === "pending");
  const stop = yield* Effect.acquireRelease(
    Effect.sync(() => new AbortController()),
    (stop) => Effect.sync(() => stop.abort()),
  );
  const discord = threadId
    ? createDiscordBridge(app, {
        botToken: process.env.DISCORD_BOT_TOKEN!,
        applicationId: process.env.DISCORD_APPLICATION_ID!,
        publicKey: process.env.DISCORD_PUBLIC_KEY!,
        ownerId: process.env.DISCORD_OWNER_ID!,
        threadId,
        respondToChannelIds: [channelId!],
      })
    : null;
  if (discord) {
    yield* resource(
      async () => {
        await discord.chat.initialize();
        return discord;
      },
      async (bridge) => {
        await bridge.chat.shutdown();
      },
    );
    yield* Effect.forkScoped(
      Effect.tryPromise(() => discord.listen(stop.signal)),
    );
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            discord.flush().catch(() => {
              console.error("Discord delivery pump failed.");
            }),
          );
          yield* Effect.sleep("1 second");
        }),
      ),
    );
  }
  const http = yield* resource(
    () =>
      startServer(app, {
        port,
        webOrigin,
        discordConfigured: !!discord,
        diagnostics: collector.traces,
        settings,
      }),
    (http) => http.close(),
  );
  lifecycle = "running";
  console.log(`Raphie runtime: ${http.url}\nRaphie workspace: ${webOrigin}`);
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

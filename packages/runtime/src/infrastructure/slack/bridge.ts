import { createSlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import type { Message, Thread } from "chat";
import { Chat, ConsoleLogger } from "chat";

import type { ChannelServices } from "../../application/channels/ports.ts";
import { createDeliveryWorker } from "../../domains/delivery/application/worker.ts";
import { InputError } from "../../shared/application/input-error.ts";
import { ASK_ACTION } from "../chat-sdk/cards.ts";
import {
  chatSdkRenderer,
  decodeChatSdkOperation,
} from "../chat-sdk/delivery.ts";

type FetchRequest = (
  ...args: Parameters<typeof fetch>
) => ReturnType<typeof fetch>;

export type SlackIdentity = {
  /** Stable across token rotation: the workspace and the bot user. */
  connectionId: string;
  teamName: string;
  botUserId: string;
};

/** Discover the workspace and bot user behind a bot token. */
export async function resolveSlackIdentity(
  botToken: string,
  lookup: FetchRequest = fetch,
): Promise<SlackIdentity> {
  const response = await lookup("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${botToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Slack identity lookup failed.");
  const result = (await response.json()) as {
    ok?: boolean;
    team_id?: unknown;
    team?: unknown;
    user_id?: unknown;
  };
  if (
    !result.ok ||
    typeof result.team_id !== "string" ||
    !/^[TE][A-Z0-9]{2,32}$/.test(result.team_id) ||
    typeof result.user_id !== "string" ||
    !/^[UW][A-Z0-9]{2,32}$/.test(result.user_id)
  )
    throw new Error("Invalid Slack identity.");
  return {
    connectionId: `slack:${result.team_id}:${result.user_id}`,
    teamName: typeof result.team === "string" ? result.team : "",
    botUserId: result.user_id,
  };
}

/** The same policy gates messages and button presses, as for Discord. */
export function slackAuthorized(
  userId: string,
  allowedUserIds: string[],
  channel: string,
  channelId?: string,
) {
  return (
    allowedUserIds.includes(userId) && (!channelId || channel === channelId)
  );
}

export type SlackBridgeConfig = {
  botToken: string;
  appToken: string;
  connectionId: string;
  botUserId: string;
  allowedUserIds: string[];
  channelId?: string;
  /** Tests point the Web API and Socket Mode handshake at a fixture. */
  apiUrl?: string;
};

/**
 * Slack through Socket Mode: the runtime opens an outbound WebSocket, so it
 * needs no public URL. Slack's `markdown_text` takes up to 12,000 characters.
 */
export function createSlackBridge(
  app: ChannelServices,
  config: SlackBridgeConfig,
) {
  // SDK info logs include message content; keep it out of service logs.
  const logger = new ConsoleLogger("silent");
  const adapter = createSlackAdapter({
    mode: "socket",
    botToken: config.botToken,
    appToken: config.appToken,
    botUserId: config.botUserId,
    ...(config.apiUrl ? { apiUrl: config.apiUrl } : {}),
    logger,
  });
  const chat = new Chat({
    userName: "raphie",
    adapters: { slack: adapter },
    state: createMemoryState(),
    logger,
    concurrency: "concurrent",
  });
  // Set once the bridge is closed. A connection still being opened when it
  // closes may finish later; nothing it delivers is handled.
  let closed = false;
  const authorized = (userId: string, threadId: string) =>
    slackAuthorized(
      userId,
      config.allowedUserIds,
      adapter.decodeThreadId(threadId).channel,
      config.channelId,
    );
  /**
   * A button press names the card's own timestamp as its thread when the card
   * is not in a thread, but the card was posted to the conversation's top
   * level. Rebuild the conversation the card was sent to from the payload.
   */
  const pressedIn = (event: { threadId: string; raw: unknown }) => {
    const raw = event.raw as {
      message?: { thread_ts?: string };
      container?: { thread_ts?: string };
    };
    return adapter.encodeThreadId({
      channel: adapter.decodeThreadId(event.threadId).channel,
      threadTs: raw?.message?.thread_ts ?? raw?.container?.thread_ts ?? "",
    });
  };
  const mention = new RegExp(`^\\s*<@${config.botUserId}(?:\\|[^>]*)?>`);

  /**
   * The adapter renders the bot's @mention as its display name, which may
   * contain spaces; strip exactly that, never the first word of the prompt.
   */
  async function promptText(message: Message) {
    const raw = (message.raw as { text?: string } | undefined)?.text ?? "";
    if (!mention.test(raw)) return message.text.trim();
    const name = (await adapter.getUser(config.botUserId))?.userName;
    for (const rendered of [name, config.botUserId])
      if (rendered && message.text.startsWith(`@${rendered}`))
        return message.text.slice(rendered.length + 1).trim();
    return message.text.trim();
  }

  const establish = (
    threadId: string,
    userId: string,
    message?: { messageId?: string },
  ) =>
    app.actors.establish(
      "slack",
      threadId,
      config.connectionId,
      userId,
      message,
    );

  chat.onSlashCommand("/home", async (event) => {
    if (closed) return;
    let reply: string;
    try {
      // A command arrives for the channel, not a thread: home is its top level.
      const channel = adapter.decodeThreadId(event.channel.id).channel;
      const threadId = adapter.encodeThreadId({ channel, threadTs: "" });
      const raw = event.raw as { trigger_id?: unknown } | undefined;
      if (event.user.isBot || !authorized(event.user.userId, threadId))
        throw new InputError(
          "You are not authorized to set home in this conversation.",
          403,
        );
      if (typeof raw?.trigger_id !== "string" || !raw.trigger_id)
        throw new InputError(
          "This command has no verified interaction identity.",
          403,
        );
      await app.home.setCurrent(
        establish(threadId, event.user.userId),
        raw.trigger_id,
      );
      reply = "This conversation is now this bot’s home for scheduled updates.";
    } catch (error) {
      reply =
        error instanceof InputError
          ? error.message
          : "I could not set the home channel. Please try again.";
    }
    await event.channel
      .postEphemeral(event.user, { raw: reply }, { fallbackToDM: false })
      .catch(() => console.error("Slack /home confirmation failed."));
  });

  async function receive(thread: Thread, message: Message) {
    if (
      closed ||
      !authorized(message.author.userId, thread.id) ||
      message.author.isBot
    )
      return;
    try {
      if (message.attachments.length)
        throw new InputError("Chat in Slack currently accepts text only.");
      const text = await promptText(message);
      // A message timestamp is unique only within its channel.
      const channel = adapter.decodeThreadId(thread.id).channel;
      await app.sessions.submit(
        establish(thread.id, message.author.userId, { messageId: message.id }),
        { eventId: `${channel}:${message.id}`, text },
      );
      // Later replies in a channel thread reach the bot without another @mention.
      if (message.isMention && !adapter.isDM(thread.id))
        await thread.subscribe().catch(() => {});
    } catch (error) {
      const text =
        error instanceof InputError
          ? error.message
          : "I could not accept that message. Please try again.";
      await adapter.postMessage(thread.id, { raw: text }).catch(() => {
        console.error("Slack message error notification failed.");
      });
    }
  }

  chat.onNewMention(receive);
  chat.onDirectMessage(receive);
  chat.onSubscribedMessage(receive);
  chat.onAction([ASK_ACTION], async (event) => {
    if (
      closed ||
      !authorized(event.user.userId, event.threadId) ||
      !event.value
    )
      return;
    const threadId = pressedIn(event);
    const [id, choice] = event.value.split(":");
    const who = establish(threadId, event.user.userId);
    // A settled question keeps its first answer; a refused press changes nothing.
    await app.asks
      .answer(
        id ?? "",
        { choice: Number(choice) },
        who.subject,
        who.source,
        undefined,
        {
          threadId,
          connectionId: config.connectionId,
          userId: event.user.userId,
        },
      )
      .catch(() => {});
  });
  chat.onAction(
    ["raphie-tool-approve", "raphie-tool-reject"],
    async (event) => {
      if (
        closed ||
        !authorized(event.user.userId, event.threadId) ||
        !event.value
      )
        return;
      await app.sessions.decide(
        establish(pressedIn(event), event.user.userId),
        event.value,
        event.actionId === "raphie-tool-approve" ? "approved" : "rejected",
      );
    },
  );

  const flush = createDeliveryWorker(
    app.deliveries.forConnection(config.connectionId),
    chatSdkRenderer(app.files, { chunk: 10_000, format: "markdown" }),
    async (payload) => {
      const operation = decodeChatSdkOperation(payload);
      const message = operation.messageId
        ? await adapter.editMessage(
            operation.threadId,
            operation.messageId,
            operation.message,
          )
        : await adapter.postMessage(operation.threadId, operation.message);
      return message.id;
    },
    app.telemetry,
  );

  /**
   * Opens the Socket Mode connection. The SDK retries an unreachable Slack for
   * a long time, so callers never block startup on this.
   */
  function connect() {
    const opening = chat.initialize();
    // A connection that opens after close is shut down again.
    void opening.then(
      () => (closed ? adapter.disconnect() : undefined),
      () => {},
    );
    return opening;
  }

  async function close() {
    closed = true;
    await chat.shutdown().catch(() => {});
  }

  return { adapter, chat, flush, connect, close };
}

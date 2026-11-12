import type { Channel, ChannelOrigin } from "@raphie/contracts";

import { InputError } from "../../shared/application/input-error.ts";

export type ActorContext = Readonly<{
  botId: string;
  subject: "owner";
  source: Channel;
  origin?: ChannelOrigin;
  threadId?: string;
  connectionId?: string;
  /** Legacy-named: the verified external user ID for any channel. */
  discordUserId?: string;
}>;

/** Only trusted adapters receive the issuer. Contexts are never deserialized from requests. */
export class ActorAuthority {
  private readonly issued = new WeakSet<ActorContext>();

  private readonly botId: string;

  constructor(botId = "default") {
    this.botId = botId;
  }

  establish(
    source: Channel,
    threadId?: string,
    connectionId = "legacy-discord",
    discordUserId?: string,
    message?: {
      messageId?: string;
      updateId?: number;
      chatType?: "private" | "group" | "supergroup";
    },
  ): ActorContext {
    if (source !== "web" && !threadId)
      throw new InputError(
        "A channel context requires a verified conversation.",
        403,
      );
    const actor: ActorContext = Object.freeze({
      ...(source !== "web" && threadId && discordUserId
        ? {
            origin: Object.freeze({
              platform: source,
              connectionId,
              conversationId: threadId,
              channelId:
                source === "discord"
                  ? threadId.split(":")[2]!
                  : threadId.split(":")[1]!,
              userId: discordUserId,
              ...(source === "discord"
                ? {
                    guildId: threadId.split(":")[1],
                    ...(threadId.split(":")[3]
                      ? { threadId: threadId.split(":")[3] }
                      : {}),
                  }
                : {}),
              ...message,
            }),
          }
        : {}),
      botId: this.botId,
      subject: "owner",
      source,
      threadId,
      connectionId,
      discordUserId: source !== "web" ? discordUserId : undefined,
    });
    this.issued.add(actor);
    return actor;
  }

  require(actor: ActorContext) {
    if (!this.issued.has(actor)) throw new InputError("Not authorized.", 403);
    return actor;
  }
}

import type { Channel } from "@raphie/contracts";

import { InputError } from "../../shared/application/input-error.ts";

export type ActorContext = Readonly<{
  botId: string;
  subject: "owner";
  source: Channel;
  threadId?: string;
  connectionId?: string;
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
  ): ActorContext {
    if (source === "discord" && !threadId)
      throw new InputError(
        "Discord context requires a verified conversation.",
        403,
      );
    const actor: ActorContext = Object.freeze({
      botId: this.botId,
      subject: "owner",
      source,
      threadId,
      connectionId,
      discordUserId: source === "discord" ? discordUserId : undefined,
    });
    this.issued.add(actor);
    return actor;
  }

  require(actor: ActorContext) {
    if (!this.issued.has(actor)) throw new InputError("Not authorized.", 403);
    return actor;
  }
}

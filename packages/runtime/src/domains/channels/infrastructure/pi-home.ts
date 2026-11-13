import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { defineDoc } from "@earendil-works/pi-durable";
import type { ChannelHomeSettings } from "@raphie/contracts";

import type {
  ActorAuthority,
  ActorContext,
} from "../../../application/access/actors.ts";
import { InputError } from "../../../shared/application/input-error.ts";
import type { DurableContext } from "../../../shared/infrastructure/durable-context.ts";
import type { ChannelHome } from "../application/home.ts";
import type { ReplyDestination } from "../domain/binding.ts";

export type HomeAddress = ReplyDestination & { userId: string };

export const homeId = (address: HomeAddress) =>
  JSON.stringify([
    address.provider,
    address.connectionId,
    address.conversation,
    address.userId,
  ]);

export const ChannelHomes = defineDoc<{
  selected: string | null;
  destinations: HomeAddress[];
  commands?: string[];
}>({
  kind: "raphie.channel-home",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ selected: null, destinations: [] }),
});

export class PiChannelHome implements ChannelHome {
  /** Host checks the current connection and account authorization at admission. */
  available: (address: HomeAddress) => boolean = () => false;

  private readonly app: DurableContext;
  private readonly authority: ActorAuthority;

  constructor(app: DurableContext, authority: ActorAuthority) {
    this.app = app;
    this.authority = authority;
  }

  async setCurrent(actor: ActorContext, eventId?: string) {
    const verified = this.authority.require(actor);
    if (
      verified.source === "web" ||
      !verified.threadId ||
      !verified.connectionId ||
      !verified.discordUserId
    )
      throw new InputError(
        "Use /home in a verified Discord or Telegram conversation.",
        403,
      );
    const address: HomeAddress = {
      provider: verified.source,
      owner: "owner",
      connectionId: verified.connectionId,
      conversation: verified.threadId,
      userId: verified.discordUserId,
    };
    await this.app.root.commit(async (tx) => {
      const state = await tx.doc(ChannelHomes);
      const command = eventId
        ? JSON.stringify([
            address.provider,
            address.connectionId,
            address.conversation,
            address.userId,
            eventId,
          ])
        : null;
      if (command && state.commands?.includes(command)) return;
      if (command) state.commands = [...(state.commands ?? []), command];
      const id = homeId(address);
      if (!state.destinations.some((item) => homeId(item) === id))
        state.destinations.push(address);
      state.selected = id;
    }, context);
  }

  async read(): Promise<ChannelHomeSettings> {
    const state = (await this.app.harness.snapshot(ChannelHomes, context)) ?? {
      selected: null,
      destinations: [],
    };
    return {
      selected: state.selected,
      destinations: state.destinations.map((item) => ({
        id: homeId(item),
        platform: item.provider,
        conversationId: item.conversation,
        userId: item.userId,
      })),
    };
  }

  async select(id: string | null) {
    await this.app.root.commit(async (tx) => {
      const state = await tx.doc(ChannelHomes);
      if (
        id !== null &&
        !state.destinations.some((item) => homeId(item) === id)
      )
        throw new InputError("Choose a known channel destination.", 400);
      state.selected = id;
    }, context);
    return this.read();
  }
}

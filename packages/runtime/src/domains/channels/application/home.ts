import type { ChannelHomeSettings } from "@raphie/contracts";

import type { ActorContext } from "../../../application/access/actors.ts";

export interface ChannelHome {
  setCurrent(actor: ActorContext, eventId?: string): Promise<void>;
  read(): Promise<ChannelHomeSettings>;
  select(id: string | null): Promise<ChannelHomeSettings>;
}

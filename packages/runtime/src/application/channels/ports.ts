import type { AskCommands } from "../../domains/asks/application/ports.ts";
import type { AttachmentStore } from "../../domains/attachments/application/ports.ts";
import type { ChannelHome } from "../../domains/channels/application/home.ts";
import type { ChannelDeliveryQueues } from "../../domains/delivery/application/worker.ts";
import type { Telemetry } from "../../shared/application/telemetry.ts";
import type { ActorAuthority } from "../access/actors.ts";
import type { SessionOperations } from "../sessions/operations.ts";

export interface ChannelServices {
  home: ChannelHome;
  telemetry: Telemetry;
  actors: ActorAuthority;
  sessions: SessionOperations;
  files: AttachmentStore;
  deliveries: ChannelDeliveryQueues;
  asks: AskCommands;
  /** The bot's usable skills, offered as channel commands such as `/weekly_report`. */
  skillCommands?(): Promise<{ name: string; description: string }[]>;
}

import type { AttachmentStore } from "../../domains/attachments/application/ports.ts";
import type { ChannelDeliveryQueues } from "../../domains/delivery/application/worker.ts";
import type { ActorAuthority } from "../access/actors.ts";
import type { SessionOperations } from "../sessions/operations.ts";

export interface ChannelServices {
  actors: ActorAuthority;
  sessions: SessionOperations;
  files: AttachmentStore;
  deliveries: ChannelDeliveryQueues;
}

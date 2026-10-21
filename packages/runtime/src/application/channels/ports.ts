import type { AttachmentStore } from "../../domains/attachments/application/ports.ts";
import type { ChannelDeliveryQueues } from "../../domains/delivery/application/worker.ts";
import type { Telemetry } from "../../shared/application/telemetry.ts";
import type { ActorAuthority } from "../access/actors.ts";
import type { SessionOperations } from "../sessions/operations.ts";

export interface ChannelServices {
  telemetry: Telemetry;
  actors: ActorAuthority;
  sessions: SessionOperations;
  files: AttachmentStore;
  deliveries: ChannelDeliveryQueues;
}

import type { GatewayState } from "../domain/file-approval.ts";

export type {
  Approval,
  Source,
  Delivery,
  GatewayState,
} from "../domain/file-approval.ts";

export { InputError } from "../../../shared/application/input-error.ts";

import { defineDoc } from "@earendil-works/pi-durable";

export const State = defineDoc<GatewayState>({
  kind: "raphie.gateway",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ approvals: [], deliveries: [] }),
});

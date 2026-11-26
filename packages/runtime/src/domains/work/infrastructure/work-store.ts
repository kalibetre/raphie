import { defineDoc } from "@earendil-works/pi-durable";
import type { WorkItem } from "@raphie/contracts";

export type WorkState = { items: WorkItem[]; next: number };

/** A bot's work items, open and closed. */
export const WorkItems = defineDoc<WorkState>({
  kind: "raphie.work-items",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ items: [], next: 1 }),
});

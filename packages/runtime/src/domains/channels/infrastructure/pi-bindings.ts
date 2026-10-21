import { defineDoc } from "@earendil-works/pi-durable";

import type { ChannelBinding } from "../domain/binding.ts";

export const ChannelBindings = defineDoc<{ bindings: ChannelBinding[] }>({
  kind: "raphie.channel-bindings",
  version: 1,
  scope: "session",
  initial: () => ({ bindings: [] }),
});

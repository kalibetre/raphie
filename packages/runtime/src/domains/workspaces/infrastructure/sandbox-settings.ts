import type { SandboxProviderInfo } from "@raphie/contracts";
import { z } from "zod";

export const sandboxProviders: SandboxProviderInfo[] = [
  { id: "just-bash", name: "just-bash", available: true, reason: null },
  {
    id: "container",
    name: "Container",
    available: true,
    reason: null,
  },
];

export const saveSandboxSettingsSchema = z
  .object({
    provider: z.enum(["just-bash", "container"]),
    hostNetworkAcknowledged: z.boolean().default(false),
    idleMinutes: z.number().int().min(1).max(1440),
    diskQuotaMiB: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable()
      .optional(),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

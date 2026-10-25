import type { SandboxProviderInfo } from "@raphie/contracts";
import { z } from "zod";

export const sandboxProviders: SandboxProviderInfo[] = [
  { id: "just-bash", name: "just-bash", available: true, reason: null },
  {
    id: "container",
    name: "Container",
    available: false,
    reason: "Container provider is not implemented yet",
  },
];

export const saveSandboxSettingsSchema = z
  .object({
    provider: z.enum(["just-bash", "container"]),
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

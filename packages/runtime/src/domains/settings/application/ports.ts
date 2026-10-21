import type { RuntimeSettings, UpdateRuntimeSettings } from "@raphie/contracts";

export interface SettingsService {
  read(): Promise<RuntimeSettings>;
  update(input: UpdateRuntimeSettings): Promise<RuntimeSettings>;
  testProvider(apiKey?: string): Promise<void>;
  /** Drop the cached model list and fetch OpenRouter's current one. */
  refreshModels(): Promise<RuntimeSettings>;
}

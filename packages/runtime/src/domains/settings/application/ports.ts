import type { RuntimeSettings, UpdateRuntimeSettings } from "@raphie/contracts";

export interface SettingsService {
  read(): RuntimeSettings;
  update(input: UpdateRuntimeSettings): Promise<RuntimeSettings>;
  testProvider(apiKey?: string): Promise<void>;
}

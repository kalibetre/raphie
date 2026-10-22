import type { RuntimeSettings, UpdateRuntimeSettings } from "@raphie/contracts";

export interface SettingsService {
  read(): Promise<RuntimeSettings>;
  update(input: UpdateRuntimeSettings): Promise<RuntimeSettings>;
  testProvider(apiKey?: string): Promise<void>;
}

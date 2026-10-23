import type {
  EditProviderConnection,
  RuntimeSettings,
  SaveProviderConnection,
  UpdateRuntimeSettings,
} from "@raphie/contracts";

export interface SettingsService {
  read(): Promise<RuntimeSettings>;
  update(input: UpdateRuntimeSettings): Promise<RuntimeSettings>;
  testProvider(apiKey?: string): Promise<void>;
  addConnection(input: SaveProviderConnection): Promise<RuntimeSettings>;
  editConnection(
    id: string,
    input: EditProviderConnection,
  ): Promise<RuntimeSettings>;
  removeConnection(id: string): Promise<RuntimeSettings>;
  testConnection(id: string, apiKey?: string): Promise<void>;
}

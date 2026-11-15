import type {
  EditProviderConnection,
  ProviderSignIn,
  RuntimeSettings,
  SaveProviderConnection,
  StartProviderSignIn,
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
  /** Subscription sign-in: started here, then read, answered or cancelled. */
  startSignIn(input: StartProviderSignIn): ProviderSignIn;
  readSignIn(id: string): ProviderSignIn;
  answerSignIn(id: string, promptId: string, value: string): ProviderSignIn;
  cancelSignIn(id: string): ProviderSignIn;
}

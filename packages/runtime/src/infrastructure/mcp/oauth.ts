import {
  adaptOAuthProvider,
  authorizeMcp,
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  type McpOAuthState,
  type McpOAuthStateStore,
  OAuthCallbackServer,
} from "@earendil-works/pi-mcp/oauth";

export type SavedMcpOAuth = { redirectUrl: string; state?: McpOAuthState };

/** One loopback callback and one grant, owned by an exact bot connection. */
export class McpOAuth {
  readonly provider: McpOAuthProvider;
  readonly authProvider;
  authorizationUrl?: string;
  failed = false;
  private callback?: OAuthCallbackServer;
  private closed = false;
  private saved: SavedMcpOAuth;
  private authorized: () => Promise<void>;

  private constructor(
    saved: SavedMcpOAuth,
    store: McpOAuthStateStore,
    serverUrl: string,
    authorized: () => Promise<void>,
    timeoutMs: number,
  ) {
    this.saved = saved;
    this.authorized = authorized;
    this.provider = new McpOAuthProvider({
      serverUrl,
      redirectUrl: saved.redirectUrl,
      clientMetadata: { client_name: "Raphie" },
      store,
      onRedirect: async (url) => {
        if (this.closed) throw new Error("Connection closed.");
        // The library validates discovered OAuth endpoints and supplies PKCE/state.
        if (this.authorizationUrl) return;
        this.callback ??= await OAuthCallbackServer.listen({
          port: Number(new URL(this.saved.redirectUrl).port),
          timeoutMs,
          renderPage: () =>
            "<!doctype html><meta name=referrer content=no-referrer><title>Raphie authorization</title><p>Authorization response received. Return to Raphie to check the connection.</p>",
        });
        const callback = this.callback;
        const response = callback.waitForCallback(await this.provider.state());
        this.authorizationUrl = url.href;
        this.failed = false;
        void response
          .then(async ({ code, iss }) => {
            if (this.closed) return;
            await authorizeMcp(this.provider, {
              serverUrl,
              authorizationCode: code,
              iss,
              signal: AbortSignal.timeout(30_000),
            });
            if (!this.closed) await this.authorized();
          })
          .catch(() => {
            if (!this.closed) this.failed = true;
          })
          .then(async () => {
            if (this.callback === callback) this.callback = undefined;
            await callback.close();
            // Each attempt needs fresh state and PKCE; never reuse a completed code.
            if (!this.closed) {
              delete this.saved.state?.oauthState;
              delete this.saved.state?.codeVerifier;
              if (this.saved.state) await store.save(this.saved.state);
            }
            this.authorizationUrl = undefined;
          })
          .catch(() => {
            /* Teardown must never leak provider errors. */
          });
      },
    });
    const auth = adaptOAuthProvider(this.provider);
    this.authProvider = {
      token: () => auth.token(),
      onUnauthorized: async (
        context: Parameters<NonNullable<typeof auth.onUnauthorized>>[0],
      ) => {
        // Another request must not replace PKCE while the owner is authorizing.
        if (this.authorizationUrl)
          throw new McpOAuthAuthorizationRequiredError();
        await auth.onUnauthorized?.(context);
      },
    };
  }

  static async open(
    serverUrl: string,
    saved: SavedMcpOAuth | undefined,
    save: (value: SavedMcpOAuth) => void,
    authorized: () => Promise<void>,
    options: { timeoutMs?: number } = {},
  ) {
    const address = new URL(serverUrl);
    if (
      address.protocol !== "https:" &&
      !(
        address.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(address.hostname)
      )
    )
      throw new Error("OAuth requires HTTPS for remote MCP servers.");
    if (!saved) {
      const callback = await OAuthCallbackServer.listen();
      saved = { redirectUrl: callback.redirectUrl };
      await callback.close();
      save(saved);
    }
    const value = saved;
    // A restarted connection must not accept a callback from an older attempt.
    delete value.state?.oauthState;
    delete value.state?.codeVerifier;
    save(value);
    const store: McpOAuthStateStore = {
      load: () => structuredClone(value.state),
      save: (state) => {
        value.state = structuredClone(state);
        save(value);
      },
    };
    return new McpOAuth(
      value,
      store,
      serverUrl,
      authorized,
      options.timeoutMs ?? 5 * 60_000,
    );
  }

  async close() {
    this.closed = true;
    this.authorizationUrl = undefined;
    await this.callback?.close();
    this.callback = undefined;
  }
}

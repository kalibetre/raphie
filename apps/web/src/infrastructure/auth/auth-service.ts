import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";

import { authSecret } from "./auth-storage.ts";

const MINIMUM_PASSWORD_LENGTH = 12;
const SESSION_DAYS = 30;

export type AuthService = Awaited<ReturnType<typeof openAuthService>>;

/**
 * Opens the single-administrator Better Auth store inside the data directory.
 * "server" instances can only sign in and out. Creating the administrator and
 * resetting a password need "admin", which only the local command line opens,
 * so neither is reachable through the web host even if a route were exposed.
 * The caller owns the returned service and must close it.
 */
export async function openAuthService(options: {
  directory: string;
  origins: string[];
  role: "server" | "admin";
}) {
  const server = options.role === "server";
  const primary = new URL(options.origins[0]!);
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const databasePath = join(options.directory, "auth.sqlite");
  const database = new Database(databasePath, { create: true });
  let resetToken: string | undefined;
  try {
    chmodSync(databasePath, 0o600);
    // The web host and the local command line can write at the same time.
    database.run(
      "PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON",
    );
    const config = {
      database,
      secret: authSecret(options.directory),
      baseURL: primary.origin,
      trustedOrigins: options.origins,
      telemetry: { enabled: false },
      advanced: {
        // Migrations just ran; a background check would race the CLI's close().
        database: { validateSchema: false },
        // Browsers share cookies across ports; keep each web host's apart.
        cookiePrefix: `raphie_${primary.port || (primary.protocol === "https:" ? "443" : "80")}`,
      },
      session: {
        expiresIn: 60 * 60 * 24 * SESSION_DAYS,
        updateAge: 60 * 60 * 24,
      },
      // One administrator: a single shared bucket is the right granularity, and
      // forwarded-address headers from the network are not trusted (see gateway).
      rateLimit: {
        enabled: true,
        storage: "database",
        window: 60,
        max: 60,
        customRules: { "/sign-in/email": { window: 60, max: 5 } },
      },
      emailAndPassword: {
        enabled: true,
        disableSignUp: server,
        autoSignIn: false,
        minPasswordLength: MINIMUM_PASSWORD_LENGTH,
        revokeSessionsOnPasswordReset: true,
        ...(server
          ? {}
          : {
              sendResetPassword: async ({ token }: { token: string }) => {
                resetToken = token;
              },
            }),
      },
    } satisfies Parameters<typeof betterAuth>[0];
    await (await getMigrations(config)).runMigrations();
    // Even racing setup commands cannot create a second administrator.
    database.run(
      'CREATE UNIQUE INDEX IF NOT EXISTS "raphie_single_user" ON "user" ((1))',
    );
    const auth = betterAuth(config);
    let configured = false;
    const isConfigured = () =>
      (configured ||=
        database.query('SELECT 1 FROM "user" LIMIT 1').get() !== null);
    return {
      /** True once an administrator exists; checked on demand so a running host notices setup. */
      configured: isConfigured,
      /** Handles Better Auth HTTP requests (sign-in and sign-out only are routed here). */
      handle: (request: Request) => auth.handler(request),
      /** Validates against the database on every call, so revocation is immediate. */
      async session(headers: Headers) {
        const result = await auth.api.getSession({
          headers,
          query: { disableCookieCache: true },
          returnHeaders: true,
        });
        return result.response
          ? { cookies: result.headers.getSetCookie() }
          : null;
      },
      async setup(email: string, password: string) {
        const exists = () =>
          new Error(
            "The administrator is already configured. Use `raphie auth recover` to reset its password.",
          );
        if (isConfigured()) throw exists();
        try {
          await auth.api.signUpEmail({
            body: { email, password, name: "Admin" },
          });
        } catch (error) {
          if (isConfigured()) throw exists();
          throw error;
        }
      },
      /** Resets the password through Better Auth, which signs every browser out. */
      async recover(password: string) {
        const user = database
          .query('SELECT email FROM "user" LIMIT 1')
          .get() as {
          email: string;
        } | null;
        if (!user)
          throw new Error(
            "No administrator is configured. Run `raphie auth setup`.",
          );
        resetToken = undefined;
        await auth.api.requestPasswordReset({ body: { email: user.email } });
        if (!resetToken) throw new Error("Could not create a password reset.");
        await auth.api.resetPassword({
          body: { token: resetToken, newPassword: password },
        });
        resetToken = undefined;
      },
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

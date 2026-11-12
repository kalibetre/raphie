import { Database } from "bun:sqlite";
import { createHash, createHmac } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { bearer, deviceAuthorization } from "better-auth/plugins";

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
    const secret = authSecret(options.directory);
    const secretFingerprint = createHash("sha256").update(secret).digest("hex");
    const config = {
      database,
      secret,
      baseURL: primary.origin,
      trustedOrigins: options.origins,
      telemetry: { enabled: false },
      plugins: [
        bearer(),
        passkey({
          rpID: primary.hostname,
          origin: primary.origin,
          rpName: "Raphie",
        }),
        deviceAuthorization({
          verificationUri: "/device",
          expiresIn: "10m",
          interval: "5s",
          validateClient: (clientId) => clientId === "raphie-native",
        }),
      ],
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
      // Incorrect credentials must not exhaust the valid credential allowance.
      // Forwarded-address headers are never trusted by the gateway.
      rateLimit: {
        enabled: true,
        storage: "database",
        window: 60,
        max: 60,
        customRules: {
          "/sign-in/email": false,
          "/passkey/generate-authenticate-options": false,
          "/passkey/verify-authentication": false,
        },
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
    database.run(
      'CREATE TABLE IF NOT EXISTS raphie_device_session (session_id TEXT PRIMARY KEY REFERENCES "session"(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at INTEGER NOT NULL)',
    );
    database.run(
      "CREATE TABLE IF NOT EXISTS raphie_auth_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    const savedFingerprint = () =>
      (
        database
          .query(
            "SELECT value FROM raphie_auth_meta WHERE key = 'secret_fingerprint'",
          )
          .get() as { value: string } | null
      )?.value;
    database
      .transaction(() => {
        if (savedFingerprint() !== secretFingerprint) {
          database.run(
            'DELETE FROM "session" WHERE id IN (SELECT session_id FROM raphie_device_session)',
          );
          database.run('DELETE FROM "deviceCode"');
          database
            .query(
              "INSERT INTO raphie_auth_meta (key, value) VALUES ('secret_fingerprint', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )
            .run(secretFingerprint);
        }
      })
      .immediate();
    // Better Auth changes the password and revokes sessions in one transaction.
    // Invalidate all outstanding device codes in that same transaction.
    database.run(
      'CREATE TRIGGER IF NOT EXISTS raphie_clear_device_codes AFTER UPDATE OF password ON "account" WHEN OLD.password IS NOT NEW.password BEGIN DELETE FROM "deviceCode"; END',
    );
    database.run(
      "CREATE TABLE IF NOT EXISTS raphie_sign_in_limit (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL)",
    );
    const auth = betterAuth(config);
    // Each origin needs its own base URL and HTTP/HTTPS cookie policy.
    // Instances share the database and signing secret, including revocation.
    const authByOrigin = new Map(
      options.origins.map((origin) => [
        origin,
        origin === primary.origin
          ? auth
          : betterAuth({
              ...config,
              baseURL: origin,
              plugins: [
                ...config.plugins.filter((plugin) => plugin.id !== "passkey"),
                passkey({
                  rpID: new URL(origin).hostname,
                  origin,
                  rpName: "Raphie",
                }),
              ],
              advanced: {
                ...config.advanced,
                cookiePrefix: `raphie_${new URL(origin).port || (new URL(origin).protocol === "https:" ? "443" : "80")}`,
              },
            }),
      ]),
    );
    const authFor = (origin?: string) =>
      origin ? (authByOrigin.get(origin) ?? auth) : auth;
    const passwordHash = () =>
      (
        database
          .query('SELECT password FROM "account" WHERE providerId = ? LIMIT 1')
          .get("credential") as { password: string | null } | null
      )?.password;
    let configured = false;
    const isConfigured = () =>
      (configured ||=
        database.query('SELECT 1 FROM "user" LIMIT 1').get() !== null);
    return {
      /** True once an administrator exists; checked on demand so a running host notices setup. */
      configured: isConfigured,
      /** Handles Better Auth HTTP requests (sign-in and sign-out only are routed here). */
      async handle(request: Request) {
        let key: string | undefined;
        if (new URL(request.url).pathname === "/api/auth/sign-in/email") {
          const body = (await request.clone().json()) as {
            email?: unknown;
            password?: unknown;
          };
          key = createHmac("sha256", secret)
            .update(JSON.stringify([body.email, body.password]))
            .digest("hex");
          const allowed = database
            .transaction(() => {
              const now = Date.now();
              // Bound storage under a flood of distinct guesses. Eviction weakens
              // guess throttling, but never turns it into an administrator lockout.
              database.run(
                "DELETE FROM raphie_sign_in_limit WHERE key IN (SELECT key FROM raphie_sign_in_limit ORDER BY expires DESC LIMIT -1 OFFSET 4095)",
              );
              database
                .query("DELETE FROM raphie_sign_in_limit WHERE expires <= ?")
                .run(now);
              const row = database
                .query(
                  "SELECT attempts FROM raphie_sign_in_limit WHERE key = ?",
                )
                .get(key!) as { attempts: number } | null;
              if (row && row.attempts >= 5) return false;
              database
                .query(
                  "INSERT INTO raphie_sign_in_limit VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1",
                )
                .run(key!, now + 60000);
              return true;
            })
            .immediate();
          if (!allowed)
            return Response.json(
              { error: "Too many attempts." },
              { status: 429 },
            );
        }
        const response = await authFor(new URL(request.url).origin).handler(
          request,
        );
        if (key && response.ok)
          database
            .query("DELETE FROM raphie_sign_in_limit WHERE key = ?")
            .run(key);
        return response;
      },
      /** Record a device session before returning its token to the client. */
      async handleDevice(request: Request) {
        if (savedFingerprint() !== secretFingerprint)
          throw new Error("Authentication secret changed.");
        const tokenRequest =
          new URL(request.url).pathname === "/api/auth/device/token";
        const before = tokenRequest ? passwordHash() : undefined;
        const response = await authFor(new URL(request.url).origin).handler(
          request,
        );
        if (!tokenRequest || !response.ok) return response;
        const payload = (await response.clone().json()) as {
          access_token?: unknown;
        };
        if (typeof payload.access_token !== "string")
          throw new Error("Device authorization failed.");
        const token = payload.access_token;
        try {
          const name =
            (request.headers.get("user-agent") ?? "Raphie device")
              .replace(/[\p{Cc}\p{Cf}]/gu, " ")
              .trim()
              .slice(0, 80) || "Raphie device";
          database
            .transaction(() => {
              if (
                !before ||
                passwordHash() !== before ||
                savedFingerprint() !== secretFingerprint
              )
                throw new Error("Administrator credentials changed.");
              const session = database
                .query('SELECT id FROM "session" WHERE token = ?')
                .get(token) as { id: string } | null;
              if (!session) throw new Error("Device session missing.");
              database
                .query(
                  "INSERT INTO raphie_device_session (session_id, name, created_at) VALUES (?, ?, ?)",
                )
                .run(session.id, name, Date.now());
            })
            .immediate();
        } catch {
          database.query('DELETE FROM "session" WHERE token = ?').run(token);
          throw new Error("Device authorization failed.");
        }
        const headers = new Headers(response.headers);
        headers.delete("set-cookie");
        headers.delete("set-auth-token");
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      },
      devices() {
        return database
          .query(
            'SELECT d.session_id AS id, d.name, d.created_at AS createdAt, s.expiresAt AS expiresAt FROM raphie_device_session d JOIN "session" s ON s.id = d.session_id WHERE s.expiresAt > ? ORDER BY d.created_at DESC',
          )
          .all(Date.now());
      },
      revokeDevice(id: string) {
        return (
          database
            .query(
              'DELETE FROM "session" WHERE id = ? AND EXISTS (SELECT 1 FROM raphie_device_session WHERE session_id = ?)',
            )
            .run(id, id).changes > 0
        );
      },
      /** Validates against the database on every call, so revocation is immediate. */
      async session(headers: Headers, origin?: string) {
        if (savedFingerprint() !== secretFingerprint) return null;
        const result = await authFor(origin).api.getSession({
          headers,
          query: { disableCookieCache: true },
          returnHeaders: true,
        });
        if (!result.response || savedFingerprint() !== secretFingerprint)
          return null;
        // A browser session token is not a device credential, even if supplied
        // via Better Auth's bearer plugin. Only issued devices are revocable and
        // invalidated when the signing secret changes.
        if (
          headers.has("authorization") &&
          !database
            .query("SELECT 1 FROM raphie_device_session WHERE session_id = ?")
            .get(result.response.session.id)
        )
          return null;
        return {
          cookies: result.headers.getSetCookie(),
          account: {
            email: result.response.user.email,
            name: result.response.user.name,
          },
        };
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
        database.run('DELETE FROM "passkey"; DELETE FROM raphie_sign_in_limit');
      },
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

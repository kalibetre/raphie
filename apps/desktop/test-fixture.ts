/** Synthetic-only fixture for the optional macOS/Tailscale integration test. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { openAuthService } from "../web/src/infrastructure/auth/auth-service.ts";
import { webOrigins } from "../web/src/infrastructure/auth/auth-storage.ts";

const configuredOrigin = process.env.RAPHIE_TEST_ORIGIN;
if (!configuredOrigin || !configuredOrigin.startsWith("https://"))
  throw new Error(
    "Set RAPHIE_TEST_ORIGIN to the temporary Tailscale HTTPS origin.",
  );
const origins = webOrigins(configuredOrigin);
const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "raphie-desktop-fixture-"));
const admin = await openAuthService({ directory, origins, role: "admin" });
await admin.setup("admin@example.test", "a long synthetic test password");
admin.close();
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: directory };
const runtime = Bun.spawn(["bun", "packages/runtime/test/browser-fixture.ts"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...env,
    RAPHIE_FIXTURE_PORT: "14327",
    RAPHIE_FIXTURE_WEB_ORIGIN: configuredOrigin,
  },
});
const web = Bun.spawn(["bun", "apps/web/server.mjs"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...env,
    DATA_DIRECTORY: directory,
    RAPHIE_WEB_ORIGIN: configuredOrigin,
    RAPHIE_WEB_PORT: "14329",
    RAPHIE_RUNTIME_URL: "http://127.0.0.1:14327",
  },
});
let cleaning = false;

async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  runtime.kill();
  web.kill();
  await Promise.all([runtime.exited, web.exited]);
  await rm(directory, { recursive: true, force: true });
}

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void cleanup());
console.log(
  "Synthetic fixture: loopback ports 14327 and 14329. Stop with Ctrl+C.",
);
await Promise.race([runtime.exited, web.exited]);
await cleanup();

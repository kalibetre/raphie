import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import start from "./dist/server/server.js";
import { startWebServer } from "./src/bootstrap/http-server.ts";
import { openAuthService } from "./src/infrastructure/auth/auth-service.ts";
import {
  authDirectory,
  webOrigins,
} from "./src/infrastructure/auth/auth-storage.ts";
import { createGateway } from "./src/infrastructure/auth/gateway.ts";

let build = { id: "development", version: "development" };
try {
  const [id, version] = readFileSync(
    new URL(
      Bun.isStandaloneExecutable ? "./.raphie-build" : "../../.raphie-build",
      import.meta.url,
    ),
    "utf8",
  )
    .trim()
    .split("\n");
  if (id && version) build = { id, version };
} catch {
  // Local development has no release metadata.
}

// A host that cannot open its authentication store must not start at all.
const origins = webOrigins(process.env.RAPHIE_WEB_ORIGIN);
const directory = authDirectory(
  fileURLToPath(new URL("../../", import.meta.url)),
  process.env.DATA_DIRECTORY,
  Bun.isStandaloneExecutable,
);
const auth = await openAuthService({ directory, origins, role: "server" });
console.log(`Authentication store: ${directory}`);
if (!auth.configured())
  console.warn(
    "Raphie is locked until an administrator is created: run `raphie auth setup`.",
  );

const server = startWebServer({
  gateway: createGateway({ service: auth, origins }),
  fetch: (request) => start.fetch(request),
  clientDirectory: fileURLToPath(new URL("./dist/client", import.meta.url)),
  port: Number(process.env.RAPHIE_WEB_PORT ?? 4320),
  build,
});
console.log(`Raphie workspace: ${server.url}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void server.stop(true).finally(() => auth.close());
  });

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import start from "./dist/server/server.js";
import { startWebServer } from "./src/bootstrap/http-server.ts";
import { openAuthService } from "./src/infrastructure/auth/auth-service.ts";
import {
  authDirectory,
  webOrigins,
} from "./src/infrastructure/auth/auth-storage.ts";
import { createGateway } from "./src/infrastructure/auth/gateway.ts";

// A release is one executable and this host a second entry point in it, so
// its own files are found from the executable's root, beside `Bun.main`.
const files = Bun.isStandaloneExecutable
  ? pathToFileURL(`${dirname(Bun.main)}/`)
  : new URL("./", import.meta.url);

let build = { id: "development", version: "development" };
try {
  const [id, version] = readFileSync(
    new URL(
      Bun.isStandaloneExecutable ? "./.raphie-build" : "../../.raphie-build",
      files,
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
const origins = webOrigins(
  process.env.RAPHIE_WEB_ORIGIN,
  Number(process.env.RAPHIE_WEB_PORT ?? 4320),
  process.env.RAPHIE_WEB_ALLOWED_ORIGINS,
);
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
  gateway: createGateway({
    service: auth,
    origins,
    localPort: Number(process.env.RAPHIE_WEB_PORT ?? 4320),
  }),
  fetch: (request) => start.fetch(request),
  clientDirectory: fileURLToPath(new URL("./dist/client", files)),
  port: Number(process.env.RAPHIE_WEB_PORT ?? 4320),
  build,
});
console.log(`Raphie workspace: ${server.url}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void server.stop(true).finally(() => auth.close());
  });

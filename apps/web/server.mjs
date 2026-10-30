import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import start from "./dist/server/server.js";
import { startWebServer } from "./src/bootstrap/http-server.ts";

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

const server = startWebServer({
  fetch: (request) => start.fetch(request),
  clientDirectory: fileURLToPath(new URL("./dist/client", import.meta.url)),
  port: Number(process.env.RAPHIE_WEB_PORT ?? 4320),
  build,
});
console.log(`Raphie workspace: ${server.url}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void server.stop(true);
  });

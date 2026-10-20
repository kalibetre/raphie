import { fileURLToPath } from "node:url";

import start from "./dist/server/server.js";
import { startWebServer } from "./src/bootstrap/http-server.ts";

const server = startWebServer({
  fetch: (request) => start.fetch(request),
  clientDirectory: fileURLToPath(new URL("./dist/client", import.meta.url)),
  port: Number(process.env.RAPHIE_WEB_PORT ?? 4320),
});
console.log(`Raphie workspace: ${server.url}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void server.stop(true);
  });

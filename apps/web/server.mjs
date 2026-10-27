import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import start from "./dist/server/server.js";
import { startWebServer } from "./src/bootstrap/http-server.ts";

if (
  process.env.RAPHIE_SERVER_MODE === "1" &&
  (!process.env.DATA_DIRECTORY ||
    !isAbsolute(process.env.DATA_DIRECTORY) ||
    !process.env.RAPHIE_WEB_ORIGIN)
)
  throw new Error(
    "Server mode requires an absolute DATA_DIRECTORY and RAPHIE_WEB_ORIGIN.",
  );

const server = startWebServer({
  fetch: (request) => start.fetch(request),
  clientDirectory: fileURLToPath(new URL("./dist/client", import.meta.url)),
  port: Number(process.env.RAPHIE_WEB_PORT ?? 4320),
  ...(process.env.RAPHIE_SERVER_MODE === "1"
    ? {
        remote: {
          origin: process.env.RAPHIE_WEB_ORIGIN,
          hostname: process.env.RAPHIE_WEB_BIND ?? "127.0.0.1",
          authDatabase: resolve(process.env.DATA_DIRECTORY, "auth.sqlite"),
        },
      }
    : {}),
});
console.log(`Raphie workspace: ${server.url}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void server.stop(true);
  });

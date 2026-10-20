import { serve } from "srvx/node";
import { staticMiddleware } from "srvx/static";
import { fileURLToPath } from "node:url";
import start from "./dist/server/server.js";
const port = Number(process.env.RAPHIE_WEB_PORT ?? 4320);
const server = serve({
  hostname: "127.0.0.1",
  port,
  middleware: [
    (request, next) =>
      ["127.0.0.1", "localhost"].includes(new URL(request.url).hostname)
        ? next()
        : new Response("Unrecognized host.", { status: 403 }),
    staticMiddleware({
      dir: fileURLToPath(new URL("./dist/client", import.meta.url)),
      dotfiles: false,
    }),
  ],
  fetch: (request) => start.fetch(request),
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void server.close();
  });

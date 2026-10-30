import { expect, test } from "bun:test";

import { installationHealthy } from "./linux-install/health-check.ts";

test("installation health requires both the runtime and the web server", async () => {
  let runtimeReady = true;
  let webReady = true;
  let webStatus = "ready";
  const runtime = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      return new Response("runtime", {
        status:
          runtimeReady && new URL(request.url).pathname === "/api/runtime"
            ? 200
            : 503,
      });
    },
  });
  const web = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const ok =
        webReady && new URL(request.url).pathname === "/_raphie/health";
      return Response.json(ok ? { status: webStatus } : {}, {
        status: ok ? 200 : 503,
      });
    },
  });
  try {
    const config = {
      PORT: String(runtime.port),
      RAPHIE_WEB_PORT: String(web.port),
    };
    expect(await installationHealthy(config)).toBe(true);
    // Locked until the administrator exists, but up and refusing everyone.
    webStatus = "locked";
    expect(await installationHealthy(config)).toBe(true);
    webStatus = "unexpected";
    expect(await installationHealthy(config)).toBe(false);
    webStatus = "ready";
    runtimeReady = false;
    expect(await installationHealthy(config)).toBe(false);
    runtimeReady = true;
    webReady = false;
    expect(await installationHealthy(config)).toBe(false);
  } finally {
    await runtime.stop(true);
    await web.stop(true);
  }
});

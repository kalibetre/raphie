import { expect, test } from "bun:test";

import { installationHealthy } from "./linux-install/health-check.ts";

test("installation health requires both the runtime and the authenticated web entry point", async () => {
  let runtimeReady = true;
  let webReady = true;
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
        webReady &&
        new URL(request.url).pathname === "/auth/connect" &&
        request.headers.get("host") === "raphie.example";
      return new Response(
        ok ? "<title>Connect to Raphie</title>" : "unavailable",
        { status: ok ? 200 : 503 },
      );
    },
  });
  try {
    const config = {
      PORT: String(runtime.port),
      RAPHIE_WEB_BIND: "127.0.0.1",
      RAPHIE_WEB_PORT: String(web.port),
      RAPHIE_WEB_ORIGIN: "https://raphie.example",
    };
    expect(await installationHealthy(config)).toBe(true);
    runtimeReady = false;
    expect(await installationHealthy(config)).toBe(false);
    runtimeReady = true;
    webReady = false;
    expect(await installationHealthy(config)).toBe(false);
    expect(
      await installationHealthy({ ...config, RAPHIE_WEB_ORIGIN: "invalid" }),
    ).toBe(false);
  } finally {
    await runtime.stop(true);
    await web.stop(true);
  }
});

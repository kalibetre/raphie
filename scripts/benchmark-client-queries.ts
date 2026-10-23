// Disposable local baseline: real Pi/SQLite/HTTP, deterministic model, no sandboxes.
import { mkdtemp, rm } from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../packages/runtime/src/bootstrap/agent-runtime.ts";
import { startServer } from "../packages/runtime/src/bootstrap/http-server.ts";
import { chatModel } from "../packages/runtime/test/chat-model.ts";

const directory = await mkdtemp(join(tmpdir(), "raphie-query-baseline-"));
const app = await Gateway.open({ directory, ...chatModel() });
const http = await startServer(app, { port: 0 });
const actor = app.actors.establish("web");
const viewers: ReadableStreamDefaultReader<Uint8Array>[] = [];
try {
  const admitted = [];
  for (let n = 0; n < 100; n++)
    admitted.push(
      await app.sessions.submit(actor, {
        eventId: `baseline-${n}`,
        text: `Session ${n}: remember Thursday`,
      }),
    );
  const deadline = Date.now() + 30_000;
  while ((await app.chats.state()).turns.some((t) => t.status === "pending")) {
    if (Date.now() > deadline)
      throw new Error("Baseline model runs did not settle.");
    await delay(10);
  }
  for (let n = 0; n < 25; n++) {
    const response = await fetch(
      `${http.url}/api/sessions/${admitted[n]!.sessionId}/events`,
    );
    if (!response.ok) throw new Error("Viewer failed to connect.");
    const reader = response.body!.getReader();
    await reader.read();
    viewers.push(reader);
  }
  const latencies: number[] = [];
  const sizes: number[] = [];
  for (let wave = 0; wave < 4; wave++)
    await Promise.all(
      admitted.slice(0, 25).map(async (receipt) => {
        const start = performance.now();
        const response = await fetch(
          `${http.url}/api/sessions/${receipt.sessionId}`,
        );
        if (!response.ok) throw new Error("Query failed.");
        const body = await response.text();
        latencies.push(performance.now() - start);
        sizes.push(Buffer.byteLength(body));
      }),
    );
  const start = performance.now();
  const next = await app.sessions.submit(actor, {
    eventId: "with-viewers",
    text: "Follow up",
    sessionId: admitted[0]!.sessionId,
  });
  while (
    (await app.chats.state()).turns.find((t) => t.id === next.id)?.status ===
    "pending"
  ) {
    if (performance.now() - start > 15_000)
      throw new Error("Viewers blocked execution.");
    await delay(10);
  }
  latencies.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        runtime: Bun.version,
        host: `${platform()}-${arch()}`,
        sessions: 100,
        concurrentSseViewers: viewers.length,
        querySamples: latencies.length,
        latencyMs: {
          p50: Math.round(latencies[49]!),
          p95: Math.round(latencies[94]!),
        },
        averageResponseBytes: Math.round(
          sizes.reduce((a, b) => a + b, 0) / sizes.length,
        ),
        followUpWithSlowViewersMs: Math.round(performance.now() - start),
        rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        model: "deterministic",
        sandboxes: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await Promise.all(viewers.map((reader) => reader.cancel()));
  await http.close();
  await app.close();
  await rm(directory, { recursive: true, force: true });
}

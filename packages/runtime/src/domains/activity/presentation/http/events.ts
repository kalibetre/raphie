import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

import type { ReadWorkspace } from "../../../../application/workspace/ports.ts";

export function streamSnapshots(c: Context, readWorkspace: ReadWorkspace) {
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (stream) => {
    let previous = "";
    let lastWrite = Date.now();
    while (!stream.aborted) {
      const current = JSON.stringify(await readWorkspace());
      if (current !== previous) {
        // Hono awaits WritableStream backpressure and owns viewer cancellation.
        await stream.writeSSE({ data: current });
        previous = current;
        lastWrite = Date.now();
      } else if (Date.now() - lastWrite >= 15_000) {
        await stream.write(": heartbeat\n\n");
        lastWrite = Date.now();
      }
      await stream.sleep(150);
    }
  });
}

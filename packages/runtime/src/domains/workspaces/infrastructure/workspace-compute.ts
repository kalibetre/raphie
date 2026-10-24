import { Worker } from "node:worker_threads";

import {
  type ComputeRequest,
  type ComputeResponse,
  computeResponseSchema,
  workspaceLimits as limits,
} from "./workspace-protocol.ts";

/** Independent host deadline terminates even a non-yielding interpreter. */
export function computeWorkspace(
  request: ComputeRequest,
  signal?: AbortSignal,
): Promise<ComputeResponse> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = new Worker(
      new URL("./workspace-worker.ts", import.meta.url),
      {
        workerData: request,
        env: {},
        execArgv: [],
      },
    );
    let settled = false;
    const finish = (result?: ComputeResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      void worker.terminate();
      if (result) resolve(result);
      else
        reject(
          new Error(
            "Workspace compute was interrupted; no checkpoint was committed.",
          ),
        );
    };
    const abort = () => finish();
    const timer = setTimeout(
      () =>
        finish({
          checkpoint: [],
          result: {
            stdout: "",
            stderr: "Workspace execution timed out; files were not changed.",
            exitCode: 124,
            committed: false,
          },
        }),
      limits.timeoutMs,
    );
    signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", (data: unknown) => {
      const parsed = computeResponseSchema.safeParse(data);
      finish(parsed.success ? parsed.data : undefined);
    });
    worker.once("error", () => finish());
    worker.once("exit", () => {
      if (!settled) finish();
    });
  });
}

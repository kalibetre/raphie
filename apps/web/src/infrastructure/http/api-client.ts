import type { ClientWorkspace } from "@raphie/contracts";

import { redirectToSignIn } from "./session";

export type Snapshot = ClientWorkspace;

export type Approval = Snapshot["toolApprovals"][number];

export type ActivityEvent = Snapshot["activity"][number];

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(
  path: string,
  data?: unknown,
  signal?: AbortSignal,
  backend?: string,
): Promise<T> {
  const headers: Record<string, string> = backend
    ? { "x-raphie-backend": backend }
    : {};
  const response = await fetch(
    path,
    data === undefined
      ? { signal, headers }
      : {
          signal,
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
            "x-raphie-client": "web",
          },
          body: JSON.stringify(data),
        },
  );
  const result = await response.json();
  if (response.status === 401 && result.code === "unauthenticated")
    redirectToSignIn();
  if (!response.ok)
    throw new ApiError(
      result.error ?? "The runtime is unavailable. Please retry.",
      response.status,
      result.code ?? "request_failed",
    );
  return result as T;
}

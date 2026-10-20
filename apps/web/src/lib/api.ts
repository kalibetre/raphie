import type { snapshot } from "../../../../packages/runtime/src/server.ts";
export type Snapshot = Awaited<ReturnType<typeof snapshot>>;
export type Approval = Snapshot["toolApprovals"][number];
export type ActivityEvent = Snapshot["activity"][number];
export async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(
    path,
    data === undefined
      ? undefined
      : {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-raphie-client": "web",
          },
          body: JSON.stringify(data),
        },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error ?? "The runtime is unavailable. Please retry.",
    );
  return result as T;
}

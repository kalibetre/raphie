import type { RuntimeInfo } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";

import { useBackend } from "../../infrastructure/http/backend-context";

export function BackendIdentity() {
  const { backend } = useBackend();
  const info = useQuery({
    queryKey: ["backend-identity", backend.url],
    queryFn: () => backend.api<RuntimeInfo>("/api/runtime"),
    refetchInterval: 10_000,
  });
  const identity = info.data?.identity;
  return (
    <details className="backend-identity">
      <summary>
        Backend {backend.url} ·{" "}
        {identity ? identity.id.slice(0, 8) : "identity unavailable"}
      </summary>
      <p>
        {identity
          ? `App data: ${identity.directory} · Workspace ID: ${identity.id}`
          : "This backend does not report a workspace identity. Check Settings → App → Backend connection before switching servers."}
      </p>
    </details>
  );
}

import { useMutation, useQuery } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";

type Mode = "ask" | "full-access";

export function McpPermissions({ sessionId }: { sessionId: string }) {
  const { workspace } = useBackend();
  const path = `/api/sessions/${encodeURIComponent(sessionId)}`;
  const mode = useQuery({
    queryKey: ["mcp-mode", sessionId],
    queryFn: () => workspace.api<{ mode: Mode }>(`${path}/approval-mode`),
  });
  const grants = useQuery({
    queryKey: ["mcp-grants", sessionId],
    queryFn: () =>
      workspace.api<{ grants: { id: string; tool: string }[] }>(
        `${path}/grants`,
      ),
    refetchInterval: 3000,
  });
  const update = useMutation({
    mutationFn: (value: Mode) =>
      workspace.api(`${path}/approval-mode`, { mode: value }, "PUT"),
    onSuccess: () => mode.refetch(),
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      workspace.api(`${path}/grants/${encodeURIComponent(id)}`, {}, "DELETE"),
    onSuccess: () => grants.refetch(),
  });
  return (
    <details className="composer-hint">
      <summary>MCP permissions</summary>
      <p>
        Applies to MCP calls only in this conversation. Sandbox restrictions and
        external approvals are unchanged.
      </p>
      <label>
        MCP access mode{" "}
        <select
          aria-label="MCP access mode"
          value={mode.data?.mode ?? "ask"}
          disabled={!mode.data || mode.isError || update.isPending}
          onChange={(event) => update.mutate(event.target.value as Mode)}
        >
          <option value="ask">Ask</option>
          <option value="full-access">Full access</option>
        </select>
      </label>
      <p>
        Ask requests approval for MCP calls without a session grant. Full access
        permits MCP calls without asking.
      </p>
      {mode.isPending && <p role="status">Loading MCP permissions…</p>}
      {(mode.isError || grants.isError) && (
        <p role="alert">
          Could not load MCP permissions.{" "}
          <button
            type="button"
            onClick={() => {
              void mode.refetch();
              void grants.refetch();
            }}
          >
            Retry
          </button>
        </p>
      )}
      {(update.isError || revoke.isError) && (
        <p role="alert">Could not save MCP permissions. Please retry.</p>
      )}
      <p>
        Session grants permit the named MCP tool on its connection with any
        arguments.
      </p>
      {grants.isPending ? (
        <p role="status">Loading session grants…</p>
      ) : grants.data?.grants.length === 0 ? (
        <p>No session grants.</p>
      ) : (
        <ul>
          {grants.data?.grants.map((grant) => (
            <li key={grant.id} className="flex flex-wrap items-center gap-2">
              <span className="break-all">{grant.tool}</span>
              <button
                type="button"
                disabled={revoke.isPending}
                aria-label={`Revoke ${grant.tool}`}
                onClick={() => revoke.mutate(grant.id)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

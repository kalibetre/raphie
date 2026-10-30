import { QueryClientProvider } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

import { BackendContext } from "../../infrastructure/http/backend-context";
import { BackendWorkspace } from "../../infrastructure/http/backend-workspace";

/** Bot changes remount every query, observer, composer and configuration form. */
export function BotBoundary({
  workspace: backend,
  children,
}: {
  workspace: BackendWorkspace;
  children: ReactNode;
}) {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const botId = search.bot ?? "default";
  // Derived during render (React's pattern for state from props), so a bot
  // change never renders an empty frame; the old scope is disposed after.
  const [scope, setScope] = useState(() => ({
    backend,
    workspace: new BackendWorkspace(backend.url, botId),
  }));
  let current = scope;
  if (scope.backend !== backend || scope.workspace.botId !== botId) {
    current = { backend, workspace: new BackendWorkspace(backend.url, botId) };
    setScope(current);
  }

  const workspace = current.workspace;
  useEffect(() => hold(workspace), [workspace]);
  const selectBot = async (id: string) => {
    await workspace.api(`/api/bots/${encodeURIComponent(id)}/profile`);
    workspace.assertActive();
    await navigate({
      to: "/",
      search: { bot: id === "default" ? undefined : id },
    });
  };
  return (
    <BackendContext.Provider value={{ workspace, backend, selectBot }}>
      <QueryClientProvider
        key={`${backend.url}:${botId}`}
        client={workspace.queries}
      >
        {children}
      </QueryClientProvider>
    </BackendContext.Provider>
  );
}

// StrictMode runs effect cleanups and re-runs them on mount. Dispose a scope
// on the next microtask only if nothing re-attached it: an actual bot change
// still retires the old scope before any network response can be handled.
const holders = new WeakMap<BackendWorkspace, number>();

function hold(workspace: BackendWorkspace) {
  holders.set(workspace, (holders.get(workspace) ?? 0) + 1);
  return () => {
    holders.set(workspace, holders.get(workspace)! - 1);
    queueMicrotask(() => {
      if (!holders.get(workspace)) workspace.dispose();
    });
  };
}

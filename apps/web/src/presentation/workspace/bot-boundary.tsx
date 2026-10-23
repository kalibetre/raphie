import { QueryClientProvider } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

import { BackendContext } from "../../infrastructure/http/backend-context";
import { BackendWorkspace } from "../../infrastructure/http/backend-workspace";

/** Bot changes remount every query, observer, composer and configuration form. */
export function BotBoundary({
  workspace: backend,
  connect,
  children,
}: {
  workspace: BackendWorkspace;
  connect: (url: string) => Promise<void>;
  children: ReactNode;
}) {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const botId = search.bot ?? "default";
  const [scope, setScope] = useState<{
    backend: BackendWorkspace;
    workspace: BackendWorkspace;
  }>();
  useEffect(() => {
    const next = new BackendWorkspace(backend.url, botId);
    setScope({ backend, workspace: next });
    return () => next.dispose();
  }, [backend, botId]);
  const workspace = scope?.workspace;
  if (!workspace || scope?.backend !== backend || workspace.botId !== botId)
    return (
      <div className="loading-state" role="status">
        <p>Loading bot…</p>
      </div>
    );
  const selectBot = async (id: string) => {
    await workspace.api(`/api/bots/${encodeURIComponent(id)}/profile`);
    workspace.assertActive();
    await navigate({
      to: "/",
      search: { bot: id === "default" ? undefined : id },
    });
  };
  return (
    <BackendContext.Provider value={{ workspace, connect, selectBot }}>
      <QueryClientProvider
        key={`${backend.url}:${botId}`}
        client={workspace.queries}
      >
        {children}
      </QueryClientProvider>
    </BackendContext.Provider>
  );
}

import { QueryClientProvider } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import { api } from "../../infrastructure/http/api-client";
import { BackendContext } from "../../infrastructure/http/backend-context";
import {
  BackendWorkspace,
  connectWorkspace,
} from "../../infrastructure/http/backend-workspace";
import { Button } from "../../shared/ui/button";

export function BackendBoundary({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<BackendWorkspace>();
  const [error, setError] = useState("");
  const active = useRef<BackendWorkspace | undefined>(undefined);
  const switching = useRef(false);

  const load = useCallback(
    async (resetRoute = false) => {
      setError("");
      try {
        const { url } = await api<{ url: string }>("/api/web/connection");
        if (resetRoute)
          await navigate({
            to: "/",
            search: { view: "settings", section: "connection" },
            replace: true,
          });
        const next = new BackendWorkspace(url);
        active.current = next;
        setWorkspace(next);
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Could not load the backend connection.",
        );
      }
    },
    [navigate],
  );

  useEffect(() => {
    void load();
    return () => active.current?.dispose();
  }, [load]);

  async function connect(url: string) {
    if (!active.current || switching.current) return;
    const previous = active.current;
    switching.current = true;
    setError("");
    try {
      await connectWorkspace(previous, url, {
        publish: (next) => {
          active.current = next;
          // Unmount every old observer/form before saving the new selection.
          flushSync(() => setWorkspace(next));
        },
        navigate: () =>
          navigate({
            to: "/",
            search: { view: "settings", section: "connection" },
            replace: true,
          }),
      });
    } catch (error) {
      if (active.current !== previous)
        setError(error instanceof Error ? error.message : "Connection failed.");
      throw error;
    } finally {
      switching.current = false;
    }
  }

  return (
    <>
      {error && <p role="alert">{error}</p>}
      {workspace ? (
        <BackendContext.Provider value={{ workspace, connect }}>
          <QueryClientProvider key={workspace.url} client={workspace.queries}>
            {children}
          </QueryClientProvider>
        </BackendContext.Provider>
      ) : (
        <div role="status" className="loading-state">
          <p>Connecting to your workspace…</p>
          {error && <Button onClick={() => void load(true)}>Try again</Button>}
        </div>
      )}
    </>
  );
}

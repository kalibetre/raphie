import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { api } from "../../infrastructure/http/api-client";
import { BackendWorkspace } from "../../infrastructure/http/backend-workspace";
import { Button } from "../../shared/ui/button";
import { BotBoundary } from "./bot-boundary";

export function BackendBoundary({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<BackendWorkspace>();
  const [error, setError] = useState("");
  const active = useRef<BackendWorkspace | undefined>(undefined);

  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    setError("");
    try {
      const { url } = await api<{ url: string }>("/api/web/connection");
      if (!isCurrent()) return;
      const next = new BackendWorkspace(url);
      active.current = next;
      setWorkspace(next);
    } catch (error) {
      if (!isCurrent()) return;
      setError(
        error instanceof Error
          ? error.message
          : "Could not load the backend connection.",
      );
    }
  }, []);

  useEffect(() => {
    let current = true;
    void load(() => current);
    return () => {
      current = false;
      active.current?.dispose();
    };
  }, [load]);

  return (
    <>
      {error && <p role="alert">{error}</p>}
      {workspace ? (
        <BotBoundary key={workspace.url} workspace={workspace}>
          {children}
        </BotBoundary>
      ) : (
        <div role="status" className="loading-state">
          <p>Connecting to your workspace…</p>
          {error && <Button onClick={() => void load()}>Try again</Button>}
        </div>
      )}
    </>
  );
}

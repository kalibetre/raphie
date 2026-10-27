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
import {
  BackendWorkspace,
  connectWorkspace,
} from "../../infrastructure/http/backend-workspace";
import { Button } from "../../shared/ui/button";
import { BotBoundary } from "./bot-boundary";

export function BackendBoundary({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<BackendWorkspace>();
  const [error, setError] = useState("");
  const active = useRef<BackendWorkspace | undefined>(undefined);
  const switching = useRef(false);

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

  async function connect(
    url: string,
    credentials?: { username: string; password: string },
  ) {
    if (!active.current || switching.current) return;
    const previous = active.current;
    switching.current = true;
    setError("");
    try {
      await connectWorkspace(
        previous,
        url,
        {
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
        },
        credentials,
      );
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
        <BotBoundary
          key={workspace.url}
          workspace={workspace}
          connect={connect}
        >
          {children}
        </BotBoundary>
      ) : (
        <div role="status" className="loading-state">
          <p>Connecting to your workspace…</p>
          {error && (
            <Button
              onClick={() =>
                void navigate({
                  to: "/",
                  search: { view: "settings", section: "connection" },
                  replace: true,
                }).then(() => load())
              }
            >
              Try again
            </Button>
          )}
        </div>
      )}
    </>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../../../infrastructure/http/api-client";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Group } from "./settings-group";

export function ConnectionSettings() {
  const current = useQuery({
    queryKey: ["backend-address"],
    queryFn: () => api<{ url: string }>("/api/web/connection"),
    retry: false,
  });
  const [draft, setDraft] = useState<string>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect(action: "test" | "connect") {
    setBusy(true);
    setMessage("");
    try {
      await api("/api/web/connection", {
        action,
        url: draft ?? current.data?.url,
      });
      if (action === "connect")
        window.location.assign("/?view=settings&section=connection");
      else setMessage("Connection successful.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group
      title="Backend connection"
      note="Choose the local server this browser connects to. Connecting reloads the workspace and opens that server’s sessions."
    >
      <div className="settings-form">
        <label htmlFor="backend-url">Backend address</label>
        <Input
          id="backend-url"
          type="url"
          value={draft ?? current.data?.url ?? ""}
          onChange={(e) => {
            setDraft(e.target.value);
            setMessage("");
          }}
          placeholder="http://127.0.0.1:4316"
          autoComplete="url"
        />
        <p>Local HTTP servers only. This address is saved in this browser.</p>
        <div className="settings-actions">
          <Button
            variant="outline"
            disabled={busy || !(draft ?? current.data?.url)}
            onClick={() => void connect("test")}
          >
            Test connection
          </Button>
          <Button
            disabled={busy || !(draft ?? current.data?.url)}
            onClick={() => void connect("connect")}
          >
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </div>
        {(message || current.error) && (
          <p role="status">
            {message || "Could not load the current connection."}
          </p>
        )}
      </div>
    </Group>
  );
}

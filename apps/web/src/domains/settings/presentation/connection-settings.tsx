import type { RuntimeInfo } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Group } from "./settings-group";

export function ConnectionSettings() {
  const { workspace, connect: connectBackend } = useBackend();
  const api = workspace.api;
  const current = useQuery({
    queryKey: ["backend-address"],
    queryFn: () => api<{ url: string }>("/api/web/connection"),
    retry: false,
  });
  const info = useQuery({
    queryKey: ["runtime-info"],
    queryFn: () => api<RuntimeInfo>("/api/runtime"),
  });
  const [draft, setDraft] = useState<string>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const address = draft ?? current.data?.url ?? "";

  async function connect(action: "test" | "connect") {
    setBusy(true);
    setMessage("");
    try {
      if (!address) return;
      if (action === "connect") await connectBackend(address);
      else {
        await api("/api/web/connection", { action, url: address });
        setMessage("Connection successful.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group
      title="Backend connection"
      note="Choose the runtime on this Raphie server. Each runtime has its own bots and data."
    >
      <div className="settings-form">
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground">
            <Radio size={17} />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium">
              Current backend
              {info.data?.identity?.kind === "fixture" ? " · Test fixture" : ""}
            </div>
            <p className="mt-1">{workspace.url}</p>
            <p className="mt-1">Address as seen by this Raphie server</p>
          </div>
        </div>
        {info.isError && (
          <p role="status">
            Could not load this backend. Check the connection.
          </p>
        )}
        <label htmlFor="backend-url">Server runtime address</label>
        <Input
          id="backend-url"
          type="url"
          disabled={busy}
          value={address}
          onChange={(e) => {
            setDraft(e.target.value);
            setMessage("");
          }}
          placeholder="http://127.0.0.1:4316"
          autoComplete="url"
        />
        <p>
          Loopback HTTP addresses on the Raphie server only. This address is
          saved in this browser.
        </p>
        <div className="settings-actions">
          <Button
            variant="outline"
            disabled={busy || !address}
            onClick={() => void connect("test")}
          >
            Test connection
          </Button>
          <Button
            disabled={busy || !address}
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

import type { RuntimeInfo } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";
import { Globe, Laptop, Radio } from "lucide-react";
import { useEffect, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Group } from "./settings-group";

export function ConnectionSettings() {
  const { workspace, connect: connectBackend } = useBackend();
  const api = workspace.api;
  const current = useQuery({
    queryKey: ["backend-address"],
    queryFn: () =>
      api<{ url: string; kind?: "local" | "remote" }>("/api/web/connection"),
    retry: false,
  });
  const info = useQuery({
    queryKey: ["runtime-info"],
    queryFn: () => api<RuntimeInfo>("/api/runtime"),
  });
  const [localDraft, setLocalDraft] = useState<string>();
  const [remoteDraft, setRemoteDraft] = useState<string>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [remoteChoice, setRemote] = useState<boolean>();
  const remote = remoteChoice ?? current.data?.kind === "remote";
  const draft = remote ? remoteDraft : localDraft;
  const setDraft = remote ? setRemoteDraft : setLocalDraft;
  const selectedAddress =
    draft ??
    (remote === (current.data?.kind === "remote") ? current.data?.url : "") ??
    "";
  const [pairingLink, setPairingLink] = useState("");
  const [saved, setSaved] = useState<string[]>([]);

  useEffect(() => {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem("raphie.saved-gateways") ?? "[]",
      );
      if (Array.isArray(value))
        setSaved(
          value
            .filter(
              (item): item is string =>
                typeof item === "string" && item.length <= 2048,
            )
            .slice(0, 20),
        );
    } catch {
      /* Browser storage is optional. */
    }
  }, []);

  function saveAddresses(addresses: string[]) {
    setSaved(addresses);
    try {
      localStorage.setItem("raphie.saved-gateways", JSON.stringify(addresses));
    } catch {
      /* Browser storage is optional. */
    }
  }

  async function connect(action: "test" | "connect") {
    setBusy(true);
    setMessage("");
    try {
      const url = selectedAddress;
      if (!url) return;
      const credentials = remote ? { pairingLink } : undefined;
      if (action === "connect") {
        if (remote)
          saveAddresses(
            [url, ...saved.filter((item) => item !== url)].slice(0, 20),
          );
        try {
          await connectBackend(url, credentials);
        } catch (error) {
          if (remote) saveAddresses(saved);
          throw error;
        }
      } else {
        await api("/api/web/connection", {
          action,
          url,
          ...(credentials ? { kind: "remote", ...credentials } : {}),
        });
        setMessage("Connection successful.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      if (action === "connect") setPairingLink("");
      setBusy(false);
    }
  }

  return (
    <Group
      title="Backend connection"
      note="Choose a local runtime or pair with a remote Raphie gateway. Each gateway has its own bots and data."
    >
      <div className="settings-form">
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground">
            <Radio size={17} />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium">
              Current connection
              {info.data?.identity?.kind === "fixture" ? " · Test fixture" : ""}
            </div>
            <p className="mt-1">{workspace.url}</p>
          </div>
        </div>
        {info.isError && (
          <p role="status">
            Could not load this gateway. Check the connection or pair again.
          </p>
        )}
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Connect to</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${!remote ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "bg-background hover:bg-muted/50"}`}
            >
              <input
                type="radio"
                name="gateway-mode"
                checked={!remote}
                onChange={() => {
                  setRemote(false);
                  setMessage("");
                }}
                className="mt-1 accent-[var(--accent)]"
              />
              <Laptop
                size={17}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-muted-foreground"
              />
              <span>
                <span className="block">Local runtime</span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  On this device
                </span>
              </span>
            </label>
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${remote ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "bg-background hover:bg-muted/50"}`}
            >
              <input
                type="radio"
                name="gateway-mode"
                checked={remote}
                onChange={() => {
                  setRemote(true);
                  setMessage("");
                }}
                className="mt-1 accent-[var(--accent)]"
              />
              <Globe
                size={17}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-muted-foreground"
              />
              <span>
                <span className="block">Remote gateway</span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  On another server
                </span>
              </span>
            </label>
          </div>
        </fieldset>
        {remote && saved.length > 0 && (
          <>
            <label htmlFor="saved-gateway">Saved gateways</label>
            <select
              id="saved-gateway"
              value={saved.includes(draft ?? "") ? draft : ""}
              onChange={(event) => setDraft(event.target.value)}
            >
              <option value="">Choose a saved gateway</option>
              {saved.map((url) => (
                <option key={url} value={url}>
                  {url}
                </option>
              ))}
            </select>
            {draft && saved.includes(draft) && (
              <Button
                variant="ghost"
                onClick={() => {
                  saveAddresses(saved.filter((url) => url !== draft));
                  setDraft("");
                }}
              >
                Remove saved gateway
              </Button>
            )}
          </>
        )}
        <label htmlFor="backend-url">
          {remote ? "Remote gateway URL" : "Local runtime address"}
        </label>
        <Input
          id="backend-url"
          type="url"
          disabled={busy}
          value={selectedAddress}
          onChange={(e) => {
            setDraft(e.target.value);
            setMessage("");
          }}
          placeholder={
            remote ? "https://your-server.example" : "http://127.0.0.1:4316"
          }
          autoComplete="url"
        />
        {remote ? (
          <>
            <p>
              Use HTTPS or a local SSH tunnel. Generate a pairing link on the
              remote server with sudo raphie pair.
            </p>
            <label htmlFor="gateway-pairing-link">Pairing link</label>
            <Input
              id="gateway-pairing-link"
              value={pairingLink}
              autoComplete="off"
              onChange={(e) => setPairingLink(e.target.value)}
            />
          </>
        ) : (
          <p>Local HTTP servers only. This address is saved in this browser.</p>
        )}
        <div className="settings-actions">
          {!remote && (
            <Button
              variant="outline"
              disabled={busy || !selectedAddress}
              onClick={() => void connect("test")}
            >
              Test connection
            </Button>
          )}
          <Button
            disabled={busy || !selectedAddress || (remote && !pairingLink)}
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

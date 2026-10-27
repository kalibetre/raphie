import type { RuntimeInfo } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";
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
  const [draft, setDraft] = useState<string>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [remoteChoice, setRemote] = useState<boolean>();
  const remote = remoteChoice ?? current.data?.kind === "remote";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
      const url = draft ?? current.data?.url;
      if (!url) return;
      const credentials = remote ? { username, password } : undefined;
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
      if (action === "connect") setPassword("");
      setBusy(false);
    }
  }

  return (
    <Group
      title="Backend connection"
      note="Choose a local runtime or sign in to a remote Raphie gateway. Each gateway has its own bots and data."
    >
      <div className="settings-form">
        <p>
          Active backend: {workspace.url}{" "}
          {info.data?.identity?.kind === "fixture" ? "(test fixture)" : ""}
        </p>
        {info.data?.identity ? (
          <p>
            App data: {info.data.identity.directory}
            <br />
            Workspace ID: {info.data.identity.id}
          </p>
        ) : info.isError ? (
          <p>
            Could not load this gateway. Check the connection or sign in again.
          </p>
        ) : (
          <p>
            This backend does not report its data identity. Upgrade it to
            identify its workspace.
          </p>
        )}
        <fieldset>
          <legend>Connection mode</legend>
          <label>
            <input
              type="radio"
              name="gateway-mode"
              checked={!remote}
              onChange={() => setRemote(false)}
            />{" "}
            Local runtime
          </label>{" "}
          <label>
            <input
              type="radio"
              name="gateway-mode"
              checked={remote}
              onChange={() => setRemote(true)}
            />{" "}
            Remote gateway
          </label>
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
          value={draft ?? current.data?.url ?? ""}
          onChange={(e) => {
            setDraft(e.target.value);
            setMessage("");
          }}
          placeholder="http://127.0.0.1:4316"
          autoComplete="url"
        />
        {remote ? (
          <>
            <p>
              Use HTTPS, a Tailscale IPv4 address, or a local SSH tunnel. The
              URL is saved; your password is not.
            </p>
            <label htmlFor="gateway-username">Username</label>
            <Input
              id="gateway-username"
              value={username}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
            />
            <label htmlFor="gateway-password">Password</label>
            <Input
              id="gateway-password"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        ) : (
          <p>Local HTTP servers only. This address is saved in this browser.</p>
        )}
        <div className="settings-actions">
          <Button
            variant="outline"
            disabled={
              busy ||
              !(draft ?? current.data?.url) ||
              (remote && (!username || !password))
            }
            onClick={() => void connect("test")}
          >
            Test connection
          </Button>
          <Button
            disabled={
              busy ||
              !(draft ?? current.data?.url) ||
              (remote && (!username || !password))
            }
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

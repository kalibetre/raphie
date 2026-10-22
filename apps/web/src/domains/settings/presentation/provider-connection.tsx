import type {
  ProviderConnection as Connection,
  RuntimeSettings,
} from "@raphie/contracts";
import { KeyRound, X } from "lucide-react";
import { useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../../shared/ui/select";
import { useProviderConnections } from "../infrastructure/use-provider-connections";

export function ProviderConnection({
  connection,
  providers,
  suggestedName,
  onClose,
}: {
  connection?: Connection;
  providers: RuntimeSettings["providers"];
  suggestedName: string;
  onClose: () => void;
}) {
  const { workspace } = useBackend();
  const api = workspace.api;
  const mutation = useProviderConnections();
  const [provider, setProvider] = useState(
    connection?.provider ?? providers[0]?.id ?? "",
  );
  const [name, setName] = useState(connection?.name ?? suggestedName);
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [testing, setTesting] = useState(false);
  const busy = testing || mutation.isPending;
  const providerName =
    providers.find((p) => p.id === provider)?.name ?? provider;
  const fieldId = connection?.id ?? "new-connection";

  async function testConnection() {
    setTesting(true);
    setMessage("");
    mutation.reset();
    try {
      await api(
        connection
          ? `/api/settings/connections/${encodeURIComponent(connection.id)}/test`
          : "/api/settings/provider/test",
        key ? { apiKey: key } : {},
      );
      setMessage("Connection successful.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <article className="provider-card provider-edit-card">
      <div className="provider-setup-heading">
        <div>
          <h3>
            {connection ? `Edit ${connection.name}` : `Connect ${providerName}`}
          </h3>
          <p>
            {connection
              ? `${providerName} · API key connection`
              : "Add an independent connection with its own name and API key."}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={
            connection ? "Cancel editing connection" : "Close new connection"
          }
          disabled={busy}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <form
        className="connection-form"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage("");
          mutation.mutate(
            connection
              ? {
                  action: "edit",
                  id: connection.id,
                  input: { name: name.trim(), ...(key ? { apiKey: key } : {}) },
                }
              : {
                  action: "add",
                  input: { provider, name: name.trim(), apiKey: key },
                },
            {
              onSuccess: () => {
                setKey("");
                onClose();
              },
            },
          );
        }}
      >
        {!connection && (
          <>
            <label htmlFor={`${fieldId}-provider`}>Provider</label>
            <Select
              value={provider}
              disabled={busy}
              onValueChange={setProvider}
            >
              <SelectTrigger id={`${fieldId}-provider`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        <label htmlFor={`${fieldId}-name`}>Connection name</label>
        <Input
          id={`${fieldId}-name`}
          value={name}
          maxLength={80}
          required
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Personal or Work"
        />
        <label htmlFor={`${fieldId}-key`}>
          {connection ? "Replace API key" : `${providerName} API key`}
        </label>
        <Input
          id={`${fieldId}-key`}
          name="provider-key"
          type="password"
          autoComplete="new-password"
          value={key}
          required={!connection}
          disabled={busy}
          onChange={(event) => {
            setKey(event.target.value);
            setMessage("");
            mutation.reset();
          }}
          placeholder={
            connection
              ? "Leave blank to keep the current key"
              : "Enter an API key"
          }
          spellCheck={false}
          aria-describedby={`${fieldId}-help`}
        />
        <p id={`${fieldId}-help`}>
          <KeyRound size={12} />
          {connection
            ? "Only this connection is updated. Its provider and identity stay the same."
            : "Keys stay on the backend. Adding a connection does not replace existing ones."}
        </p>
        <div className="settings-actions">
          <Button
            type="submit"
            disabled={busy || !name.trim() || (!connection && !key)}
          >
            {mutation.isPending
              ? "Saving…"
              : connection
                ? "Save changes"
                : "Add connection"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || (!connection && !key)}
            onClick={() => void testConnection()}
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>
        {(message || mutation.error) && (
          <p role="status">{mutation.error?.message ?? message}</p>
        )}
      </form>
    </article>
  );
}

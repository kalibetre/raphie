import type {
  ProviderConnection as Connection,
  RuntimeSettings,
} from "@raphie/contracts";
import { KeyRound, LogIn, X } from "lucide-react";
import { useCallback, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import { useProviderConnections } from "../infrastructure/use-provider-connections";
import { useProviderSignIn } from "../infrastructure/use-provider-sign-in";
import { ProviderSignInSteps } from "./provider-sign-in";
import { useSettingsGuard } from "./use-settings-guard";

export function ProviderConnection({
  connection,
  providers,
  suggestedName,
  suggestName = () => suggestedName,
  onClose,
}: {
  connection?: Connection;
  providers: RuntimeSettings["providers"];
  suggestedName: string;
  /** A name for a new connection to `provider`, e.g. "OpenAI 2". */
  suggestName?: (provider: string) => string;
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
  const guard = useSettingsGuard(
    !!key ||
      name !== (connection?.name ?? suggestedName) ||
      provider !== (connection?.provider ?? providers[0]?.id ?? ""),
    busy,
  );
  const chosen = providers.find((p) => p.id === provider);
  const providerName = chosen?.name ?? provider;
  const fieldId = connection?.id ?? "new-connection";
  // A subscription signs in through its provider instead of taking a key.
  const subscription = connection
    ? connection.auth === "subscription"
    : !!chosen?.auth?.includes("subscription") &&
      !chosen.auth.includes("api_key");
  const signInLabel = chosen?.signInLabel ?? `Sign in to ${providerName}`;
  const signedIn = useCallback(() => onClose(), [onClose]);
  const signing = useProviderSignIn(signedIn);
  const signIn = signing.signIn;
  const signingIn = !!signIn && signIn.status === "waiting";

  function startSignIn() {
    setMessage("");
    mutation.reset();
    signing.reset();
    signing.start.mutate({
      provider,
      name: name.trim(),
      ...(connection ? { connectionId: connection.id } : {}),
    });
  }

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
              ? `${providerName} · ${subscription ? "Subscription" : "API key connection"}`
              : subscription
                ? "Sign in with your subscription account. Raphie keeps the sign-in on the backend and renews it as needed."
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
          onClick={() => {
            if (signingIn) signing.cancel.mutate();
            onClose();
          }}
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
              items={providers.map((p) => ({ value: p.id, label: p.name }))}
              value={provider}
              disabled={busy}
              onValueChange={(value) => {
                if (value === null) return;
                // A name still at its suggestion follows the provider.
                if (name === suggestName(provider)) setName(suggestName(value));
                setProvider(value);
              }}
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
          disabled={busy || signingIn}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Personal or Work"
        />
        {subscription ? (
          <SubscriptionSignIn
            connection={connection}
            label={signInLabel}
            canStart={!!name.trim() && !busy}
            signing={signing}
            onStart={startSignIn}
          />
        ) : (
          <>
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
          </>
        )}
        <div className="settings-actions">
          {(!subscription || connection) && (
            <Button
              type="submit"
              disabled={
                busy || signingIn || !name.trim() || (!connection && !key)
              }
            >
              {mutation.isPending
                ? "Saving…"
                : connection
                  ? "Save changes"
                  : "Add connection"}
            </Button>
          )}
          {(!subscription || connection) && (
            <Button
              type="button"
              variant="outline"
              disabled={busy || signingIn || (!connection && !key)}
              onClick={() => void testConnection()}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (signingIn) signing.cancel.mutate();
              onClose();
            }}
          >
            Cancel
          </Button>
        </div>
        {guard.message && <p role="status">{guard.message}</p>}
        {(message || mutation.error) && (
          <p role="status">{mutation.error?.message ?? message}</p>
        )}
      </form>
    </article>
  );
}

/** The sign-in part of a subscription connection's form. */
function SubscriptionSignIn({
  connection,
  label,
  canStart,
  signing,
  onStart,
}: {
  connection?: Connection;
  label: string;
  canStart: boolean;
  signing: ReturnType<typeof useProviderSignIn>;
  onStart: () => void;
}) {
  const signIn = signing.signIn;
  const waiting = signIn?.status === "waiting";
  const startError = signing.start.error?.message;
  return (
    <>
      {connection?.needsSignIn && !signIn && (
        <p role="alert">
          This subscription’s sign-in expired and could not be renewed. Sign in
          again to keep using it.
        </p>
      )}
      {!waiting && (
        <Button
          type="button"
          className="justify-self-start"
          disabled={!canStart || signing.start.isPending}
          onClick={onStart}
        >
          <LogIn />
          {signing.start.isPending
            ? "Starting…"
            : connection
              ? "Sign in again"
              : label}
        </Button>
      )}
      {signIn && waiting && (
        <ProviderSignInSteps
          signIn={signIn}
          answering={signing.answer.isPending}
          onAnswer={(promptId, value) =>
            signing.answer.mutate({ promptId, value })
          }
        />
      )}
      {(signIn?.status === "failed" || startError) && (
        <p role="alert">{signIn?.error ?? startError}</p>
      )}
      {signIn?.status === "cancelled" && (
        <p role="status">Sign-in cancelled.</p>
      )}
      {signing.answer.error && (
        <p role="alert">{signing.answer.error.message}</p>
      )}
      <p>
        <KeyRound size={12} />
        {connection
          ? "Signing in again renews this connection. Its name and identity stay the same."
          : "Only one sign-in can run on a backend at a time."}
      </p>
    </>
  );
}

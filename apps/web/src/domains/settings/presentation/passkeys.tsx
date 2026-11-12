import { useState } from "react";

import { authClient } from "../../../infrastructure/auth/client";
import { Button } from "../../../shared/ui/button";
import { Group, Row } from "./settings-group";

export function Passkeys() {
  const { data: keys, error, refetch } = authClient.useListPasskeys();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function change(id?: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = id
        ? await authClient.passkey.deletePasskey({ id })
        : await authClient.passkey.addPasskey({
            name: window.location.hostname,
          });
      if (result?.error) throw new Error(result.error.message);
      await refetch();
      setMessage(id ? "Passkey removed." : "Passkey registered.");
    } catch {
      setMessage("Could not complete the passkey request. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group
      title="Passkeys"
      note="Use a passkey on this hostname. Keep your password for fallback. Local auth recovery removes all passkeys."
    >
      <Row
        title="Register a passkey"
        description="Use localhost or your configured HTTPS address."
      >
        <Button variant="outline" disabled={busy} onClick={() => void change()}>
          Add passkey
        </Button>
      </Row>
      {error && (
        <p role="alert" className="p-4 text-sm text-destructive">
          Could not load passkeys. Reload to retry.
        </p>
      )}
      {!keys && !error && (
        <Row
          title="Loading passkeys…"
          description="Checking administrator credentials."
        />
      )}
      {keys?.length === 0 && (
        <Row
          title="No passkeys"
          description="Register one with your device or security key."
        />
      )}
      {keys?.map((key) => (
        <Row
          key={key.id}
          title={key.name || "Passkey"}
          description="Administrator sign-in credential"
        >
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void change(key.id)}
          >
            Remove
          </Button>
        </Row>
      ))}
      {message && (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </Group>
  );
}

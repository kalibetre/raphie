import { useState } from "react";

import { signOut } from "../../../infrastructure/http/session";
import { Button } from "../../../shared/ui/button";
import { Group, Row } from "./settings-group";

export function AccountSettings() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function leave() {
    setBusy(true);
    setMessage("");
    try {
      await signOut();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not sign out.",
      );
      setBusy(false);
    }
  }

  return (
    <Group
      title="Sign out"
      note="Ends the session in this browser. Other browsers stay signed in; to end them all, run “raphie auth recover” on the Raphie machine."
    >
      <Row
        title="This browser"
        description="You will need your password to sign in again."
      >
        <Button variant="outline" disabled={busy} onClick={() => void leave()}>
          {busy ? "Signing out…" : "Sign out"}
        </Button>
      </Row>
      {message && <p role="status">{message}</p>}
    </Group>
  );
}

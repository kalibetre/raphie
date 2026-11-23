import type { BotMcpConnection } from "@raphie/contracts";
import { useState } from "react";

import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";

/**
 * What the bot should use one connection for, in the owner's words. The
 * bot reads it in every conversation, so it knows to look here for a
 * calendar or a ticket before saying it has none.
 */
export function McpPurpose({
  connection,
  pending,
  onSave,
}: {
  connection: BotMcpConnection;
  pending: boolean;
  onSave: (purpose: string) => Promise<void>;
}) {
  const saved = connection.purpose ?? "";
  const [draft, setDraft] = useState(saved);
  const id = `mcp-purpose-${connection.id}`;
  const changed = draft.trim() !== saved;
  return (
    <form
      className="mcp-purpose"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(draft.trim());
      }}
    >
      <label htmlFor={id} className="mcp-purpose-label">
        What {connection.name} is for
      </label>
      <Input
        id={id}
        className="mcp-purpose-input"
        maxLength={300}
        placeholder={
          connection.summary ?? "Calendar, mail, tickets and code hosting"
        }
        value={draft}
        disabled={pending}
        onChange={(event) => setDraft(event.target.value)}
      />
      {changed && (
        <>
          <Button type="submit" size="sm" disabled={pending}>
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setDraft(saved)}
          >
            Discard
          </Button>
        </>
      )}
    </form>
  );
}

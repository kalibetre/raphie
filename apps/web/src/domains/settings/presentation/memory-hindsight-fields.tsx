import type { MemoryStatus } from "@raphie/contracts";
import type { Dispatch, SetStateAction } from "react";

import { Input } from "../../../shared/ui/input";

type Configuration = MemoryStatus["configuration"];

/** Endpoint, bank and key fields that only apply to a Hindsight backend. */
export function HindsightFields({
  draft,
  setDraft,
  apiKey,
  setApiKey,
  clearKey,
  setClearKey,
  hasCredential,
  busy,
}: {
  draft: Configuration;
  setDraft: Dispatch<SetStateAction<Configuration>>;
  apiKey: string;
  setApiKey: (value: string) => void;
  clearKey: boolean;
  setClearKey: (value: boolean) => void;
  hasCredential: boolean;
  busy: boolean;
}) {
  return (
    <>
      <label htmlFor="memory-endpoint">Hindsight endpoint</label>
      <Input
        id="memory-endpoint"
        type="url"
        placeholder="http://127.0.0.1:8888"
        required
        value={draft.endpoint}
        disabled={busy}
        onChange={(e) =>
          setDraft((current) => ({
            ...current,
            endpoint: e.target.value,
          }))
        }
      />
      <label htmlFor="memory-bank">Bank ID</label>
      <Input
        id="memory-bank"
        required
        maxLength={80}
        pattern={"[a-zA-Z0-9_\\-]{1,80}"}
        value={draft.bankId}
        disabled={busy}
        onChange={(e) =>
          setDraft((current) => ({
            ...current,
            bankId: e.target.value,
          }))
        }
      />
      <label htmlFor="memory-api-key">
        API key {hasCredential ? "· saved" : "· optional for a local server"}
      </label>
      <Input
        id="memory-api-key"
        type="password"
        autoComplete="new-password"
        value={apiKey}
        disabled={busy || clearKey}
        placeholder={
          hasCredential ? "Leave blank to keep saved key" : "Enter an API key"
        }
        onChange={(e) => setApiKey(e.target.value)}
      />
      <p>
        Encrypted with the backend’s OS credential store. Re-enter or clear it
        when changing the destination.
      </p>
      {hasCredential && (
        <label className="memory-check">
          <input
            type="checkbox"
            checked={clearKey}
            disabled={busy}
            onChange={(e) => {
              setClearKey(e.target.checked);
              setApiKey("");
            }}
          />{" "}
          Clear saved API key
        </label>
      )}
    </>
  );
}

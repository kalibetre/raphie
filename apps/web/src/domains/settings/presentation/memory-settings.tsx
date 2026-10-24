import type { MemoryStatus } from "@raphie/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

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
import { Switch } from "../../../shared/ui/switch";
import { useMemory } from "../infrastructure/use-memory";
import { MemoryCapabilities } from "./memory-capabilities";
import { HindsightFields } from "./memory-hindsight-fields";
import { SaveBar } from "./save-bar";
import { Group, Row } from "./settings-group";
import { SettingsStatus } from "./settings-status";
import { useSettingsGuard } from "./use-settings-guard";

export function MemorySettings() {
  const memory = useMemory();
  if (!memory.data)
    return (
      <SettingsStatus
        title="Memory backend"
        message={
          memory.error
            ? "Memory settings are unavailable. This backend may need an update."
            : "Loading memory settings…"
        }
        onRetry={memory.error ? () => void memory.refetch() : undefined}
      />
    );
  return <MemoryConfiguration status={memory.data} memory={memory} />;
}

function MemoryConfiguration({
  status,
  memory,
}: {
  status: MemoryStatus;
  memory: ReturnType<typeof useMemory>;
}) {
  const { workspace } = useBackend();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(status.configuration);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const busy = testing || memory.update.isPending;
  const external = draft.provider === "hindsight";
  // Key fields only apply to Hindsight; hidden ones never count or get sent.
  const keyChange = external ? clearKey || !!key : false;
  const saved = JSON.stringify(status.configuration);
  const dirty = JSON.stringify(draft) !== saved || keyChange;
  const guard = useSettingsGuard(dirty, busy);
  // Follow configuration saved elsewhere unless the owner is editing. Staying
  // mounted (not remounting on save) keeps keyboard focus on the form.
  const [base, setBase] = useState(saved);
  if (saved !== base) {
    setBase(saved);
    if (JSON.stringify(draft) === base && !keyChange)
      setDraft(status.configuration);
  }

  async function test() {
    setTesting(true);
    setMessage("");
    try {
      await workspace.api("/api/memory/test", {});
      setMessage("Connection successful.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <Group
        title="Memory backend"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void navigate({
                to: ".",
                search: (previous) => ({
                  ...previous,
                  view: "settings",
                  section: "memory-browse",
                  bot:
                    workspace.botId === "default" ? undefined : workspace.botId,
                }),
              })
            }
          >
            Browse memories
          </Button>
        }
        note="One active backend. Switching preserves existing data; it does not copy or merge memories."
      >
        <form
          className="memory-form"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage("");
            const { hasCredential: _, ...configuration } = draft;
            memory.update.mutate(
              {
                ...configuration,
                ...(!external
                  ? {}
                  : clearKey
                    ? { apiKey: null }
                    : key
                      ? { apiKey: key }
                      : {}),
              },
              {
                onSuccess: (next) => {
                  setDraft(next.configuration);
                  setKey("");
                  setClearKey(false);
                },
              },
            );
          }}
        >
          <Row
            title="Enable memory"
            description="Allow the agent to retain selected information and recall it in future sessions. Whole conversations are never uploaded automatically."
          >
            <Switch
              aria-label="Enable memory"
              checked={draft.enabled}
              disabled={busy}
              onCheckedChange={(enabled) =>
                setDraft((current) => ({ ...current, enabled }))
              }
            />
          </Row>
          <div className="settings-form">
            <label htmlFor="memory-backend">Backend</label>
            <Select
              items={{
                builtin: "Raphie · built-in",
                hindsight: "Hindsight",
                honcho: "Honcho · planned",
                markdown: "Obsidian / Markdown · planned",
              }}
              value={draft.provider}
              disabled={busy}
              onValueChange={(value) => {
                if (value === "builtin" || value === "hindsight")
                  setDraft((current) => ({ ...current, provider: value }));
              }}
            >
              <SelectTrigger id="memory-backend">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="builtin">Raphie · built-in</SelectItem>
                <SelectItem value="hindsight">Hindsight</SelectItem>
                <SelectItem value="honcho" disabled>
                  Honcho · planned
                </SelectItem>
                <SelectItem value="markdown" disabled>
                  Obsidian / Markdown · planned
                </SelectItem>
              </SelectContent>
            </Select>
            <p>
              {external
                ? "Connect your Hindsight server and a dedicated bank. Selected memories leave this device when retained or queried."
                : "Stored locally in this backend’s SQLite database. Search is lexical; the conversation model synthesizes reflections from evidence. No background consolidation yet."}
            </p>
            <label htmlFor="memory-scope">Owner / assistant scope</label>
            <Input
              id="memory-scope"
              value={draft.scope}
              disabled={busy}
              required
              maxLength={80}
              pattern={"[a-zA-Z0-9_\\-]{1,80}"}
              onChange={(e) =>
                setDraft((current) => ({ ...current, scope: e.target.value }))
              }
            />
            <p>
              Only this scope is available to the agent. Changing it leaves the
              previous scope’s memories intact.
            </p>
            {external && (
              <HindsightFields
                draft={draft}
                setDraft={setDraft}
                apiKey={key}
                setApiKey={setKey}
                clearKey={clearKey}
                setClearKey={setClearKey}
                hasCredential={status.configuration.hasCredential}
                busy={busy}
              />
            )}
            <div className="settings-actions">
              <Button
                type="button"
                variant="outline"
                disabled={busy || dirty || !status.configuration.enabled}
                onClick={() => void test()}
              >
                {testing ? "Testing…" : "Test saved connection"}
              </Button>
              {dirty && <p>Save before testing; tests use the saved setup.</p>}
            </div>
            {message && !dirty && <p role="status">{message}</p>}
          </div>
          <SaveBar
            visible={dirty || busy || !!guard.message || !!memory.update.error}
            status={
              guard.message || (dirty ? "Unsaved memory changes" : "Saved")
            }
            error={memory.update.error?.message}
            pending={memory.update.isPending}
            canSave={dirty && !testing}
            canDiscard={dirty}
            label="Save memory settings"
            onDiscard={() => {
              setDraft(status.configuration);
              setKey("");
              setClearKey(false);
            }}
          />
        </form>
      </Group>
      <MemoryCapabilities status={status} />
    </>
  );
}

import type { MemoryStatus } from "@raphie/contracts";
import { BookOpen, Database, Network } from "lucide-react";
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
import { MemoryEvidenceBrowser } from "./memory-evidence-browser";
import { Group, Row } from "./settings-group";

export function MemorySettings() {
  const memory = useMemory();
  if (!memory.data)
    return (
      <Group title="Memory">
        <div className="settings-form">
          <p role="status">
            {memory.error
              ? "Memory settings are unavailable. This backend may need an update."
              : "Loading memory settings…"}
          </p>
          <Button variant="outline" onClick={() => void memory.refetch()}>
            Retry
          </Button>
        </div>
      </Group>
    );
  return (
    <MemoryConfiguration
      key={JSON.stringify(memory.data.configuration)}
      status={memory.data}
      memory={memory}
    />
  );
}

function MemoryConfiguration({
  status,
  memory,
}: {
  status: MemoryStatus;
  memory: ReturnType<typeof useMemory>;
}) {
  const { workspace } = useBackend();
  const [draft, setDraft] = useState(status.configuration);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const busy = testing || memory.update.isPending;
  const external = draft.provider === "hindsight";
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(status.configuration) ||
    !!key ||
    clearKey;

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
      <header className="catalog-heading">
        <div>
          <h2>Memory across sessions</h2>
          <p>Keep useful facts and experiences, with their sources.</p>
        </div>
        <BookOpen size={22} aria-hidden="true" />
      </header>
      <Group
        title="Memory backend"
        note="One active backend. Switching preserves existing data; it does not copy or merge memories."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setMessage("");
            const { hasCredential: _, ...configuration } = draft;
            memory.update.mutate(
              {
                ...configuration,
                ...(clearKey ? { apiKey: null } : key ? { apiKey: key } : {}),
              },
              {
                onSuccess: () => {
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
                  API key{" "}
                  {status.configuration.hasCredential
                    ? "· saved"
                    : "· optional for a local server"}
                </label>
                <Input
                  id="memory-api-key"
                  type="password"
                  autoComplete="new-password"
                  value={key}
                  disabled={busy || clearKey}
                  placeholder={
                    status.configuration.hasCredential
                      ? "Leave blank to keep saved key"
                      : "Enter an API key"
                  }
                  onChange={(e) => setKey(e.target.value)}
                />
                <p>
                  Encrypted with the backend’s OS credential store. Re-enter or
                  clear it when changing the destination.
                </p>
                {status.configuration.hasCredential && (
                  <label className="memory-check">
                    <input
                      type="checkbox"
                      checked={clearKey}
                      disabled={busy}
                      onChange={(e) => {
                        setClearKey(e.target.checked);
                        setKey("");
                      }}
                    />{" "}
                    Clear saved API key
                  </label>
                )}
              </>
            )}
            <div className="settings-actions">
              <Button type="submit" disabled={busy || !dirty}>
                {memory.update.isPending ? "Saving…" : "Save memory settings"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || dirty || !status.configuration.enabled}
                onClick={() => void test()}
              >
                {testing ? "Testing…" : "Test saved connection"}
              </Button>
            </div>
            {dirty && (
              <p>Save changes before testing or browsing this backend.</p>
            )}
            {(message || memory.update.error) && (
              <p role="status">{memory.update.error?.message ?? message}</p>
            )}
          </div>
        </form>
      </Group>
      <Group title="Available on this backend">
        <Row
          title="Retain and recall"
          description="Explicit memory tools, source references and a bounded search result."
        >
          <Database size={16} aria-hidden="true" />
        </Row>
        <Row
          title={
            status.capabilities.reflect === "provider"
              ? "Provider reflection"
              : "Model-assisted reflection"
          }
          description={
            status.capabilities.reflect === "provider"
              ? "Hindsight reasons over memories and manages consolidation. Use a dedicated bank; scope tags are retrieval filters, not tenant isolation."
              : "The agent reasons from local evidence and cites its IDs. Derived reflections are not stored as facts."
          }
        >
          <Network size={16} aria-hidden="true" />
        </Row>
        <Row
          title="Correct and forget"
          description={
            status.capabilities.revise
              ? "Edit or remove built-in evidence below, or ask the agent. Historical chat transcripts and backups are separate."
              : "Manage source corrections and deletions directly in Hindsight. These actions are not available through Raphie yet."
          }
        >
          <span className="settings-value">
            {status.capabilities.revise ? "Available" : "External"}
          </span>
        </Row>
      </Group>
      {status.configuration.enabled && !dirty && (
        <MemoryEvidenceBrowser
          key={JSON.stringify(status.configuration)}
          canManage={status.capabilities.revise && status.capabilities.forget}
          liveSearch={status.configuration.provider === "builtin"}
        />
      )}
    </>
  );
}

import { useEffect, useState } from "react";
import { ChevronRight, Menu, PanelRight, Puzzle } from "lucide-react";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { Welcome } from "./welcome";
import { Route } from "../routes/index";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { useLiveState } from "../lib/live";
import { api } from "../lib/api";
import { Activity } from "./activity";
import { Chat } from "./chat";
import { Composer } from "./composer";
import { readLocal, writeLocal } from "../lib/storage";
import { plugins } from "../plugins";

export function Workspace() {
  const { conversation: conversationId, view } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data, connected, isPending, error, refetch } = useLiveState();
  const [inspector, setInspector] = useState(false);
  useEffect(() => {
    setInspector(window.innerWidth > 1100);
  }, []);
  const [sidebar, setSidebar] = useState(false);
  const [suggestion, setSuggestion] = useState<{ text: string; at: number }>();
  const [enabled, setEnabled] = useState(plugins.map((p) => p.id));
  useEffect(() => {
    try {
      const saved = JSON.parse(readLocal("raphie:plugins") ?? "null");
      if (Array.isArray(saved) && saved.every((id) => typeof id === "string"))
        setEnabled(
          saved.filter((id) => plugins.some((plugin) => plugin.id === id)),
        );
    } catch {}
  }, []);
  const conversation = data?.conversations.find((c) => c.id === conversationId);
  const busy = !!data?.turns.some(
    (t) => t.conversationId === conversationId && t.status === "pending",
  );
  const events =
    data?.activity.filter(
      (e) => view === "diagnostics" || e.conversationId === conversationId,
    ) ?? [];
  async function send(text: string, eventId: string) {
    const sent = await api<{ id: string; conversationId: number }>(
      "/api/chat",
      { text, eventId, conversationId },
    );
    setSuggestion(undefined);
    await refetch();
    if (conversationId !== sent.conversationId)
      await navigate({ search: { conversation: sent.conversationId } });
  }
  function select(id?: number, nextView?: "diagnostics" | "plugins") {
    setSuggestion(undefined);
    void navigate({ search: { conversation: id, view: nextView } });
    setSidebar(false);
  }
  return (
    <div
      className={`workspace ${inspector && !view && conversation ? "with-inspector" : ""}`}
    >
      <a className="skip-link" href="#main">
        Skip to conversation
      </a>
      {sidebar && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        />
      )}
      <WorkspaceSidebar
        data={data}
        conversationId={conversationId}
        view={view}
        sidebar={sidebar}
        setSidebar={setSidebar}
        connected={connected}
        select={select}
      />
      <main id="main" className="main-panel" inert={sidebar}>
        <header className="workspace-header">
          <div>
            <Button
              className="mobile-menu"
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              onClick={() => {
                setSidebar(true);
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLButtonElement>(
                      '[aria-label="Close navigation"]',
                    )
                    ?.focus(),
                );
              }}
            >
              <Menu />
            </Button>
            <span className="breadcrumb">Workspace</span>
            <ChevronRight size={13} />
            <h1>
              {view === "diagnostics"
                ? "Diagnostics"
                : view === "plugins"
                  ? "Plugins"
                  : (conversation?.title ?? "New conversation")}
            </h1>
          </div>
          <div>
            <Badge variant="outline">
              <span className={`status-dot ${connected ? "" : "offline"}`} />
              {connected ? "Live" : "Offline"}
            </Badge>
            {!view && conversation && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Toggle activity inspector"
                aria-pressed={inspector}
                onClick={() => setInspector(!inspector)}
              >
                <PanelRight size={17} />
              </Button>
            )}
          </div>
        </header>
        {error && !connected && (
          <div className="runtime-error" role="alert">
            Could not reach the runtime. Your drafts are saved.
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        )}
        {isPending ? (
          <div className="loading-state" role="status">
            <div />
            <div />
            <div />
            <p>Connecting to your workspace…</p>
          </div>
        ) : view === "diagnostics" ? (
          <Activity events={events} full />
        ) : view === "plugins" ? (
          <section className="settings-page">
            <span className="eyebrow">MAKE IT YOURS</span>
            <h2>Small additions. More useful conversations.</h2>
            <p>
              Trusted local plugins extend your workspace through explicit UI
              slots.
            </p>
            {plugins.map((plugin) => (
              <div className="plugin-row" key={plugin.id}>
                <span className="plugin-icon">
                  <Puzzle size={20} />
                </span>
                <div>
                  <h3>{plugin.name}</h3>
                  <p>
                    Estimates tokens in your current draft. Actual usage is
                    recorded separately in Diagnostics.
                  </p>
                  <code>
                    {plugin.id} · v{plugin.version} · composer.footer
                  </code>
                </div>
                <label className="plugin-toggle">
                  <input
                    type="checkbox"
                    checked={enabled.includes(plugin.id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...enabled, plugin.id]
                        : enabled.filter((id) => id !== plugin.id);
                      setEnabled(next);
                      writeLocal("raphie:plugins", JSON.stringify(next));
                    }}
                  />
                  Enabled
                </label>
              </div>
            ))}
          </section>
        ) : (
          <>
            {conversation && data ? (
              <Chat
                key={conversation.id}
                state={data}
                conversationId={conversation.id}
              />
            ) : (
              <Welcome
                disabled={!connected || !data?.model}
                onSuggest={(text) => setSuggestion({ text, at: Date.now() })}
              />
            )}
            {conversationId && !conversation && data && (
              <p role="alert" className="error">
                This conversation could not be found. Start a new conversation
                from the sidebar.
              </p>
            )}
            {!data?.model && (
              <p className="model-warning" role="status">
                Configure a model on the runtime to start chatting.
              </p>
            )}
            <Composer
              key={conversationId ?? "new"}
              conversationId={conversationId}
              suggestion={suggestion}
              model={data?.model?.modelId ?? null}
              disabled={
                !connected ||
                !data?.model ||
                (!!conversationId && !conversation)
              }
              busy={busy}
              enabledPlugins={enabled}
              onSend={send}
            />
          </>
        )}
      </main>
      {inspector && !view && conversation && (
        <aside className="inspector" inert={sidebar}>
          <Activity events={events} />
        </aside>
      )}
    </div>
  );
}

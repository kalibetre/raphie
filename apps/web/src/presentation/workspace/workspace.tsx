import { useNavigate } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useState } from "react";

import { Activity } from "../../domains/activity/presentation/activity";
import { runUsage } from "../../domains/conversations/application/run-projection";
import { Chat } from "../../domains/conversations/presentation/chat";
import { Composer } from "../../domains/conversations/presentation/composer";
import { SessionSidebar } from "../../domains/conversations/presentation/sessions/session-sidebar";
import { Welcome } from "../../domains/conversations/presentation/welcome";
import { useEnabledPlugins } from "../../domains/settings/infrastructure/plugins/use-enabled-plugins";
import type { Section } from "../../domains/settings/presentation/settings";
import {
  sections,
  Settings,
} from "../../domains/settings/presentation/settings";
import { SettingsNav } from "../../domains/settings/presentation/settings-nav";
import { api } from "../../infrastructure/http/api-client";
import { TooltipProvider } from "../../shared/ui/tooltip";
import { PanelResizeHandle } from "./panel-resize-handle";
import { useWorkspaceLayout } from "./use-workspace-layout";
import { useLiveState } from "./use-workspace-state";
import { WorkspaceAlert } from "./workspace-alert";
import { WorkspaceHeader } from "./workspace-header";

export function Workspace({
  sessionId,
  legacyConversationId,
  view,
  section = "general",
}: {
  sessionId?: string;
  legacyConversationId?: number;
  view?: "diagnostics" | "settings";
  section?: Section;
}) {
  const navigate = useNavigate();
  const {
    data,
    connected,
    isPending,
    error,
    refetch,
    legacySessionId,
    sessionMissing,
    nextBefore,
    loadOlder,
    loadingOlder,
    loadMoreSessions,
    hasMoreSessions,
    loadMoreActivity,
    hasMoreActivity,
  } = useLiveState(sessionId, legacyConversationId, view === "diagnostics");
  const conversation = data?.conversations.find(
    (c) => c.sessionId === (sessionId ?? legacySessionId),
  );
  const {
    inspector,
    setInspector,
    sidebar,
    setSidebar,
    collapsed,
    toggleCollapsed,
    resizePanel,
    visibleNavigationWidth,
    visibleActivityWidth,
    navigationMax,
    activityMax,
  } = useWorkspaceLayout(!!conversation, view);
  const [suggestion, setSuggestion] = useState<{ text: string; at: number }>();
  const [enabled, setEnabled] = useEnabledPlugins();
  const conversationId = conversation?.id;
  const missing =
    sessionMissing ||
    (!!(sessionId || legacyConversationId) && !!data && !conversation);
  useEffect(() => {
    if (legacyConversationId && conversation?.sessionId) {
      void navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: conversation.sessionId },
        search: { view, section: view === "settings" ? section : undefined },
        replace: true,
      });
    }
  }, [legacyConversationId, conversation?.sessionId, navigate, view, section]);
  const busy = !!data?.turns.some(
    (t) => t.conversationId === conversationId && t.status === "pending",
  );
  const usage = data?.turns
    .filter((t) => t.conversationId === conversationId)
    .map((t) => runUsage(t.id, data.activity))
    .reduce(
      (sum, u) => ({
        tokens: sum.tokens + (u?.tokens ?? 0),
        cost: sum.cost + (u?.cost ?? 0),
      }),
      { tokens: 0, cost: 0 },
    );
  const events =
    data?.activity.filter(
      (e) => view === "diagnostics" || e.conversationId === conversationId,
    ) ?? [];

  async function send(text: string, eventId: string) {
    const sent = await api<{
      id: string;
      sessionId: string;
    }>("/api/sessions/messages", { text, eventId, sessionId: conversationId });
    setSuggestion(undefined);
    await refetch();
    if (conversationId !== sent.sessionId)
      await navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: sent.sessionId },
        search: {},
      });
  }

  function select(id?: string, nextView?: "diagnostics" | "settings") {
    setSuggestion(undefined);
    const selected = data?.conversations.find((c) => c.id === id);
    if (selected)
      void navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: selected.sessionId },
        search: { view: nextView },
      });
    else void navigate({ to: "/", search: { view: nextView } });
    setSidebar(false);
  }

  let title: string | undefined =
    conversation?.title ?? (missing ? "Session unavailable" : "New session");
  if (view === "diagnostics") title = "Diagnostics";
  if (view === "settings")
    title = sections.find((s) => s.id === section)?.label;
  return (
    <TooltipProvider delayDuration={300}>
      <div
        style={
          {
            "--sidebar-width": `${visibleNavigationWidth}px`,
            "--inspector-width": `${visibleActivityWidth}px`,
          } as CSSProperties
        }
        className={`workspace ${inspector && !view && conversation ? "with-inspector" : ""} ${collapsed ? "sidebar-collapsed" : ""}`}
      >
        <a className="skip-link" href="#main">
          Skip to conversation
        </a>
        {!collapsed && (
          <PanelResizeHandle
            side="left"
            value={visibleNavigationWidth}
            maxWidth={navigationMax}
            onChange={(value) => resizePanel("left", value)}
          />
        )}
        {sidebar && (
          <button
            className="sidebar-backdrop"
            aria-label="Close navigation"
            onClick={() => setSidebar(false)}
          />
        )}
        {view === "settings" ? (
          <SettingsNav
            section={section}
            open={sidebar}
            onSelect={(next) => {
              if (conversation)
                void navigate({
                  to: "/sessions/$sessionId",
                  params: { sessionId: conversation.sessionId },
                  search: { view, section: next },
                });
              else void navigate({ to: "/", search: { view, section: next } });
              setSidebar(false);
            }}
            onBack={() => select(conversationId)}
          />
        ) : (
          <SessionSidebar
            data={data}
            conversationId={conversationId}
            view={view}
            sidebar={sidebar}
            setSidebar={setSidebar}
            connected={connected}
            select={select}
            hasMore={hasMoreSessions}
            loadMore={() => void loadMoreSessions()}
          />
        )}
        <main id="main" className="main-panel" inert={sidebar}>
          <WorkspaceHeader
            title={title}
            breadcrumb={view === "settings" ? "Settings" : "raphie"}
            collapsed={collapsed}
            inspector={inspector}
            showInspector={!view && !!conversation}
            onOpenNavigation={() => setSidebar(true)}
            onToggleNavigation={toggleCollapsed}
            onToggleInspector={() => setInspector(!inspector)}
          />
          {error ? (
            <WorkspaceAlert
              title="Couldn’t connect to your workspace"
              description="Your saved sessions and drafts are still on this device. Check that the runtime is running, then try again."
              icon="connection"
              onAction={() => void refetch()}
              action="Try again"
            />
          ) : isPending ? (
            <div className="loading-state" role="status">
              <div />
              <div />
              <div />
              <p>Connecting to your workspace…</p>
            </div>
          ) : missing && !view ? (
            <WorkspaceAlert
              title="Session not found"
              description="This link doesn’t match a session in the current workspace. Choose a saved session from the sidebar or start a new one."
              icon="missing"
              onAction={() => select()}
              action="New session"
            />
          ) : view === "diagnostics" ? (
            <>
              <Activity events={events} full />
              {hasMoreActivity && (
                <button onClick={() => void loadMoreActivity()}>
                  Load earlier activity
                </button>
              )}
            </>
          ) : view === "settings" ? (
            <Settings
              section={section}
              data={data}
              connected={connected}
              enabled={enabled}
              setEnabled={setEnabled}
            />
          ) : (
            <div className="chat-stage">
              {nextBefore && (
                <button
                  disabled={loadingOlder}
                  onClick={() => void loadOlder()}
                >
                  {loadingOlder ? "Loading…" : "Load earlier messages"}
                </button>
              )}
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
              {!data?.model && (
                <p className="model-warning" role="status">
                  Configure a model on the runtime to start chatting.
                </p>
              )}
              <Composer
                key={`composer-${conversationId ?? "new"}`}
                conversationId={conversationId}
                suggestion={suggestion}
                model={data?.model?.modelId ?? null}
                usage={usage?.tokens ? usage : undefined}
                disabled={
                  !connected ||
                  !data?.model ||
                  (!!conversationId && !conversation)
                }
                busy={busy}
                enabledPlugins={enabled}
                onSend={send}
              />
            </div>
          )}
        </main>
        {inspector && !view && conversation && (
          <aside className="inspector" inert={sidebar}>
            <PanelResizeHandle
              side="right"
              value={visibleActivityWidth}
              maxWidth={activityMax}
              onChange={(value) => resizePanel("right", value)}
            />
            <Activity events={events} />
          </aside>
        )}
      </div>
    </TooltipProvider>
  );
}

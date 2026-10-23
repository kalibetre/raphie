import type { ModelSelection } from "@raphie/contracts";
import { useNavigate } from "@tanstack/react-router";
import { type CSSProperties, useCallback, useEffect, useState } from "react";

import { Activity } from "../../domains/activity/presentation/activity";
import { runUsage } from "../../domains/conversations/application/run-projection";
import { Chat } from "../../domains/conversations/presentation/chat";
import { Composer } from "../../domains/conversations/presentation/composer";
import { ConversationLibrary } from "../../domains/conversations/presentation/sessions/conversation-library";
import { ReplyCard } from "../../domains/conversations/presentation/sessions/reply-card";
import { Welcome } from "../../domains/conversations/presentation/welcome";
import { Diagnostics } from "../../domains/diagnostics/presentation/diagnostics";
import { useEnabledPlugins } from "../../domains/settings/infrastructure/plugins/use-enabled-plugins";
import { BotSidebar } from "../../domains/settings/presentation/bot-sidebar";
import type { Section } from "../../domains/settings/presentation/settings";
import { Settings } from "../../domains/settings/presentation/settings";
import { SettingsWindow } from "../../domains/settings/presentation/settings-nav";
import { useBackend } from "../../infrastructure/http/backend-context";
import {
  readLocal,
  writeLocal,
} from "../../infrastructure/preferences/storage";
import { TooltipProvider } from "../../shared/ui/tooltip";
import { PanelResizeHandle } from "./panel-resize-handle";
import { useBotInbox } from "./use-bot-inbox";
import { useWorkspaceLayout } from "./use-workspace-layout";
import { useLiveState } from "./use-workspace-state";
import { WorkspaceAlert } from "./workspace-alert";
import { WorkspaceHeader } from "./workspace-header";

export function Workspace({
  sessionId,
  legacyConversationId,
  view,
  section = "bot",
}: {
  sessionId?: string;
  legacyConversationId?: number;
  view?: "diagnostics" | "settings";
  section?: Section;
}) {
  const { workspace } = useBackend();
  const api = workspace.api;
  const bot = workspace.botId === "default" ? undefined : workspace.botId;
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
  } = useLiveState(sessionId, legacyConversationId);
  const inbox = useBotInbox(data?.conversations);
  const botProfile = inbox.bots.data?.items.find(
    (b) => b.id === workspace.botId,
  );
  const [library, setLibrary] = useState(false);
  const summaries = [
    ...new Map(
      [
        ...(data?.conversations ?? []),
        ...(inbox.byBot.get(workspace.botId) ?? []),
      ].map((s) => [s.id, s]),
    ).values(),
  ].sort((a, b) => b.lastAt - a.lastAt);
  const unread = (session: (typeof summaries)[number]) =>
    inbox.unread(workspace.botId, session);
  const lastSessionKey = useCallback(
    (id: string) =>
      `raphie:last-session:${encodeURIComponent(workspace.url)}:${id}`,
    [workspace.url],
  );
  const conversation = data?.conversations.find(
    (c) => c.sessionId === (sessionId ?? legacySessionId),
  );
  const {
    inspector,
    setInspector,
    setSidebar,
    collapsed,
    collapse,
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
        search: {
          bot,
          view,
          section: view === "settings" ? section : undefined,
        },
        replace: true,
      });
    }
  }, [
    legacyConversationId,
    conversation?.sessionId,
    navigate,
    view,
    section,
    bot,
  ]);
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
  const readSessionId = conversation?.sessionId;
  const readCount = conversation?.replyCount ?? 0;
  const markInboxRead = inbox.markRead;
  const markRead = useCallback(() => {
    if (readSessionId) markInboxRead(workspace.botId, readSessionId, readCount);
  }, [markInboxRead, workspace.botId, readSessionId, readCount]);
  useEffect(() => {
    if (readSessionId)
      writeLocal(lastSessionKey(workspace.botId), readSessionId);
  }, [workspace.botId, lastSessionKey, readSessionId]);
  const events =
    data?.activity.filter((e) => e.conversationId === conversationId) ?? [];

  async function send(text: string, eventId: string, model?: ModelSelection) {
    const sent = await api<{
      id: string;
      sessionId: string;
    }>("/api/sessions/messages", {
      text,
      eventId,
      sessionId: conversationId,
      model,
    });
    setSuggestion(undefined);
    await refetch();
    workspace.assertActive();
    if (conversationId !== sent.sessionId)
      await navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: sent.sessionId },
        search: {
          bot,
        },
      });
  }

  function select(id?: string, nextView?: "diagnostics" | "settings") {
    setSuggestion(undefined);
    setLibrary(false);
    const selected = summaries.find((c) => c.id === id);
    if (selected)
      void navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: selected.sessionId },
        search: {
          bot,
          view: nextView,
        },
      });
    else
      void navigate({
        to: "/",
        search: {
          bot,
          view: nextView,
        },
      });
    setSidebar(false);
  }

  function openSettings(next: Section) {
    if (conversation)
      void navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: conversation.sessionId },
        search: { bot, view: "settings", section: next },
      });
    else
      void navigate({
        to: "/",
        search: { bot, view: "settings", section: next },
      });
  }

  let title: string | undefined =
    conversation?.title ??
    (missing ? "Conversation unavailable" : "New conversation");
  if (view === "diagnostics") title = "Diagnostics";
  if (view === "settings")
    return (
      <TooltipProvider delay={300}>
        <SettingsWindow
          section={section}
          botId={workspace.botId}
          open={!collapsed}
          onOpenChange={(open) => collapse(!open)}
          onBack={() => select(conversationId)}
          onSelect={(id, next) => {
            if (id === workspace.botId) openSettings(next);
            else
              void navigate({
                to: "/",
                search: {
                  bot: id === "default" ? undefined : id,
                  view: "settings",
                  section: next,
                },
              });
          }}
        >
          <Settings
            section={section}
            enabled={enabled}
            setEnabled={setEnabled}
            onDiagnostics={() => select(conversationId, "diagnostics")}
          />
        </SettingsWindow>
      </TooltipProvider>
    );
  return (
    <TooltipProvider delay={300}>
      <div
        style={
          {
            "--sidebar-width": `${visibleNavigationWidth}px`,
            "--inspector-width": `${visibleActivityWidth}px`,
          } as CSSProperties
        }
        className={`workspace bot-first ${inspector && !view && conversation ? "with-inspector" : ""} ${collapsed ? "sidebar-collapsed" : ""}`}
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
        <BotSidebar
          bots={inbox.bots.data?.items ?? []}
          botId={workspace.botId}
          byBot={inbox.byBot}
          unread={inbox.unread}
          connected={connected}
          error={!!inbox.bots.error}
          onRetry={() => void inbox.bots.refetch()}
          onSelect={(id) => {
            const nextBot = id === "default" ? undefined : id;
            const last = readLocal(lastSessionKey(id));
            if (last)
              void navigate({
                to: "/sessions/$sessionId",
                params: { sessionId: last },
                search: { bot: nextBot },
              });
            else void navigate({ to: "/", search: { bot: nextBot } });
          }}
          onSettings={() => {
            openSettings("general");
          }}
          onCreate={() => {
            void navigate({
              to: "/",
              search: { bot, view: "settings", section: "new-bot" },
            });
          }}
        />
        <main id="main" className="main-panel">
          <WorkspaceHeader
            title={title}
            breadcrumb={botProfile?.name ?? "Raphie"}
            botId={workspace.botId}
            description={botProfile?.description ?? "Your personal assistant"}
            onBack={view ? () => select(conversationId) : undefined}
            onNew={!view ? () => select() : undefined}
            onLibrary={!view ? () => setLibrary(!library) : undefined}
            library={library}
            unreadCount={
              summaries.filter((s) => unread(s) > 0 || s.waiting).length
            }
            onBotSettings={() => {
              void navigate({
                to: "/",
                search: { bot, view: "settings", section: "bot" },
              });
            }}
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
              action="New conversation"
            />
          ) : view === "diagnostics" ? (
            <Diagnostics />
          ) : library ? (
            <ConversationLibrary
              name={botProfile?.name ?? "Raphie"}
              sessions={summaries}
              selectedId={conversationId}
              unread={unread}
              onSelect={select}
              onBack={() => setLibrary(false)}
              hasMore={!!hasMoreSessions}
              loadMore={() => void loadMoreSessions()}
            />
          ) : (
            <>
              <ReplyCard
                sessions={summaries.filter(
                  (s) =>
                    s.id !== conversationId && (unread(s) > 0 || s.waiting),
                )}
                unread={unread}
                onSelect={select}
                storageKey={`raphie:reply-card:${encodeURIComponent(workspace.url)}:${workspace.botId}`}
                onViewAll={() => setLibrary(true)}
              />
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
                    onRead={markRead}
                  />
                ) : (
                  <Welcome
                    disabled={!connected || !data?.model}
                    onSuggest={(text) =>
                      setSuggestion({ text, at: Date.now() })
                    }
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
                  model={conversation?.model ?? data?.model ?? null}
                  usage={usage?.tokens ? usage : undefined}
                  disabled={
                    !connected ||
                    !data?.model ||
                    (!!conversationId && !conversation)
                  }
                  busy={busy}
                  enabledPlugins={enabled}
                  onSend={send}
                  onChooseModel={async (model) => {
                    if (!conversationId) return;
                    await api(`/api/sessions/${conversationId}/model`, model);
                    await refetch();
                  }}
                  onModelSettings={() => {
                    if (conversation)
                      void navigate({
                        to: "/sessions/$sessionId",
                        params: { sessionId: conversation.sessionId },
                        search: {
                          bot,
                          view: "settings",
                          section: "models",
                        },
                      });
                    else
                      void navigate({
                        to: "/",
                        search: {
                          bot,
                          view: "settings",
                          section: "models",
                        },
                      });
                  }}
                />
              </div>
            </>
          )}
        </main>
        {inspector && !view && conversation && (
          <aside className="inspector">
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

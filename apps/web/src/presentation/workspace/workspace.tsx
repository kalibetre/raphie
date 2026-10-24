import type { ModelSelection } from "@raphie/contracts";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquareText } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useState } from "react";

import { BotActivity } from "../../domains/activity/presentation/bot-activity";
import { runUsage } from "../../domains/conversations/application/run-projection";
import { Chat } from "../../domains/conversations/presentation/chat";
import { Composer } from "../../domains/conversations/presentation/composer";
import { ConversationList } from "../../domains/conversations/presentation/sessions/conversation-list";
import { ReplyCard } from "../../domains/conversations/presentation/sessions/reply-card";
import { Welcome } from "../../domains/conversations/presentation/welcome";
import { Diagnostics } from "../../domains/diagnostics/presentation/diagnostics";
import { useEnabledPlugins } from "../../domains/settings/infrastructure/plugins/use-enabled-plugins";
import { BotAvatar } from "../../domains/settings/presentation/bot-avatar";
import { BotSidebar } from "../../domains/settings/presentation/bot-sidebar";
import { BotTonesProvider } from "../../domains/settings/presentation/bot-tones";
import type { Section } from "../../domains/settings/presentation/settings";
import { Settings } from "../../domains/settings/presentation/settings";
import { SettingsMain } from "../../domains/settings/presentation/settings-main";
import { SettingsNav } from "../../domains/settings/presentation/settings-nav";
import { useBackend } from "../../infrastructure/http/backend-context";
import {
  readLocal,
  writeLocal,
} from "../../infrastructure/preferences/storage";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
} from "../../shared/ui/sidebar";
import { TooltipProvider } from "../../shared/ui/tooltip";
import { useIsMobile } from "../../shared/ui/use-mobile";
import { PanelResizeHandle } from "./panel-resize-handle";
import { useBotInbox } from "./use-bot-inbox";
import { useWorkspaceLayout } from "./use-workspace-layout";
import { useLiveState } from "./use-workspace-state";
import { WorkspaceAlert } from "./workspace-alert";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspacePanel } from "./workspace-panel";

export function Workspace({
  sessionId,
  legacyConversationId,
  view,
  section = "bot",
}: {
  sessionId?: string;
  legacyConversationId?: number;
  view?: "settings";
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
  const attention = summaries.filter((s) => unread(s) > 0 || s.waiting).length;
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
  } = useWorkspaceLayout(view, workspace.botId);
  const [suggestion, setSuggestion] = useState<{ text: string; at: number }>();
  const [enabled, setEnabled] = useEnabledPlugins();
  const mobile = useIsMobile();
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

  function select(id?: string, nextView?: "settings") {
    setSuggestion(undefined);
    if (mobile) setInspector(false);
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

  function selectSettings(id: string, next: Section) {
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
  }

  let title: string | undefined =
    conversation?.title ??
    (missing ? "Conversation unavailable" : "New conversation");
  const settings = view === "settings";
  const roster = (
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
        openSettings("bot");
      }}
      onCreate={() => {
        void navigate({
          to: "/",
          search: { bot, view: "settings", section: "new-bot" },
        });
      }}
    />
  );
  const content = (
    <TooltipProvider delay={300}>
      {/* One shadcn sidebar shell; only its content changes between views. */}
      <SidebarProvider
        open={!collapsed}
        onOpenChange={(open) => collapse(!open)}
        style={
          {
            "--sidebar-width": `${visibleNavigationWidth}px`,
            "--inspector-width": `${visibleActivityWidth}px`,
          } as CSSProperties
        }
        // No width animation: the sidebar tracks its resize handle exactly.
        className="workspace-shell [&_[data-slot=sidebar-container]]:transition-none [&_[data-slot=sidebar-gap]]:transition-none"
      >
        <a className="skip-link" href="#main">
          {settings ? "Skip to settings" : "Skip to conversation"}
        </a>
        {/* Mobile chat keeps its bot strip; mobile settings use the sheet. */}
        {(settings || !mobile) && (
          <Sidebar aria-label={settings ? "Settings navigation" : "Bots"}>
            {settings ? (
              <SettingsNav
                section={section}
                botId={workspace.botId}
                onBack={() => select(conversationId)}
                onSelect={selectSettings}
              />
            ) : (
              roster
            )}
          </Sidebar>
        )}
        {!collapsed && !mobile && (
          <PanelResizeHandle
            side="left"
            value={visibleNavigationWidth}
            maxWidth={navigationMax}
            onChange={(value) => resizePanel("left", value)}
          />
        )}
        <SidebarInset id="main" className="main-panel">
          {settings ? (
            <SettingsMain
              section={section}
              botId={workspace.botId}
              onBack={() => select(conversationId)}
            >
              <Settings
                section={section}
                enabled={enabled}
                setEnabled={setEnabled}
                traces={<Diagnostics />}
                activity={<BotActivity />}
                onParent={(next) => selectSettings(workspace.botId, next)}
              />
            </SettingsMain>
          ) : (
            <>
              {mobile && roster}
              <WorkspaceHeader
                title={title}
                breadcrumb={botProfile?.name ?? "Raphie"}
                botId={workspace.botId}
                description={
                  botProfile?.description ?? "Your personal assistant"
                }
                onBack={view ? () => select(conversationId) : undefined}
                onNew={!view ? () => select() : undefined}
                unreadCount={attention}
                onBotSettings={() => openSettings("bot")}
                collapsed={collapsed}
                inspector={inspector}
                showInspector={!view}
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
                    onViewAll={() => setInspector(true)}
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
                        avatar={<BotAvatar id={workspace.botId} />}
                        disabled={!connected || !data?.model}
                        onSuggest={(text) =>
                          setSuggestion({ text, at: Date.now() })
                        }
                      />
                    )}
                    <Composer
                      key={`composer-${conversationId ?? "new"}`}
                      conversationId={conversationId}
                      suggestion={suggestion}
                      model={conversation?.model ?? data?.model ?? null}
                      needsModel={!data?.model}
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
                        await api(
                          `/api/sessions/${conversationId}/model`,
                          model,
                        );
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
            </>
          )}
        </SidebarInset>
        {!view && (
          <WorkspacePanel
            open={inspector}
            onOpenChange={setInspector}
            width={visibleActivityWidth}
            maxWidth={activityMax}
            onResize={(value) => resizePanel("right", value)}
            tabs={[
              {
                id: "conversations",
                label: "Conversations",
                icon: <MessageSquareText aria-hidden="true" />,
                badge: attention,
                content: (
                  <ConversationList
                    name={botProfile?.name ?? "Raphie"}
                    sessions={summaries}
                    selectedId={conversationId}
                    unread={unread}
                    onSelect={select}
                    hasMore={!!hasMoreSessions}
                    loadMore={() => void loadMoreSessions()}
                  />
                ),
              },
            ]}
          />
        )}
      </SidebarProvider>
    </TooltipProvider>
  );
  return (
    <BotTonesProvider bots={inbox.bots.data?.items ?? []}>
      {content}
    </BotTonesProvider>
  );
}

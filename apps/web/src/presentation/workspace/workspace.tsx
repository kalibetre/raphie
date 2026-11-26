import type { ModelSelection, Quote } from "@raphie/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { BotActivity } from "../../domains/activity/presentation/bot-activity";
import {
  contextTokens,
  runUsage,
} from "../../domains/conversations/application/run-projection";
import { useHandoffs } from "../../domains/conversations/infrastructure/use-handoffs";
import { Chat } from "../../domains/conversations/presentation/chat";
import { Composer } from "../../domains/conversations/presentation/composer";
import { HistoryNotice } from "../../domains/conversations/presentation/sessions/history-notice";
import { lastSessionKey } from "../../domains/conversations/presentation/sessions/last-session";
import { Welcome } from "../../domains/conversations/presentation/welcome";
import { Diagnostics } from "../../domains/diagnostics/presentation/diagnostics";
import { useEnabledPlugins } from "../../domains/settings/infrastructure/plugins/use-enabled-plugins";
import { useSkills } from "../../domains/settings/infrastructure/use-skills";
import { BotAvatar } from "../../domains/settings/presentation/bot-avatar";
import {
  BotSetup,
  useNeedsSetup,
} from "../../domains/settings/presentation/bot-setup";
import { BotSidebar } from "../../domains/settings/presentation/bot-sidebar";
import { BotTonesProvider } from "../../domains/settings/presentation/bot-tones";
import type { Section } from "../../domains/settings/presentation/settings";
import { Settings } from "../../domains/settings/presentation/settings";
import { SettingsMain } from "../../domains/settings/presentation/settings-main";
import { SettingsNav } from "../../domains/settings/presentation/settings-nav";
import { useBackend } from "../../infrastructure/http/backend-context";
import { writeLocal } from "../../infrastructure/preferences/storage";
import { Button } from "../../shared/ui/button";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
} from "../../shared/ui/sidebar";
import { TooltipProvider } from "../../shared/ui/tooltip";
import { useIsMobile } from "../../shared/ui/use-mobile";
import { notificationItems } from "./notification-items";
import { Notifications, useJobNotifications } from "./notifications";
import { TeammateFlow, type TeammateFlowMode } from "./onboarding";
import { showsOnboarding } from "./onboarding-gate";
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
  skill,
  message,
}: {
  sessionId?: string;
  legacyConversationId?: number;
  view?: "settings" | "notifications";
  section?: Section;
  /** A skill to open when `section` is Skills. */
  skill?: string;
  /** The turn whose message the chat opens at, as an inbox entry links. */
  message?: string;
}) {
  const { workspace } = useBackend();
  const api = workspace.api;
  const queries = useQueryClient();
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
  } = useLiveState(sessionId, legacyConversationId);
  // A session archived before chats counts toward no badge; the chat always
  // counts, even if it was archived then.
  const active = data?.conversations.filter((c) => !c.archivedAt || c.chat);
  const inbox = useBotInbox(active);
  const notificationBots = inbox.bots.data?.items ?? [];
  const skillItems = useSkills().list.data?.items;
  // Skills a message can invoke, so "/name" at its start shows as a skill.
  const skillNames = useMemo(
    () =>
      (skillItems ?? [])
        .filter((skill) => skill.enabled && !skill.problem)
        .map((skill) => skill.name),
    [skillItems],
  );
  const jobNotifications = useJobNotifications(notificationBots);
  const notifications = notificationItems(
    notificationBots,
    inbox.byBot,
    jobNotifications.entries,
  );
  // Approvals, and every job run not yet dismissed, including those past
  // the loaded page.
  const notificationCount =
    notifications.length +
    jobNotifications.count -
    jobNotifications.entries.length;
  const botProfile = inbox.bots.data?.items.find(
    (b) => b.id === workspace.botId,
  );
  const summaries = [
    ...new Map(
      [...(active ?? []), ...(inbox.byBot.get(workspace.botId) ?? [])].map(
        (s) => [s.id, s],
      ),
    ).values(),
  ].sort((a, b) => b.lastAt - a.lastAt);
  const chat = summaries.find((s) => s.chat);
  const conversation = data?.conversations.find(
    (c) => c.sessionId === (sessionId ?? legacySessionId),
  );
  const {
    setSidebar,
    collapsed,
    collapse,
    toggleCollapsed,
    resizePanel,
    visibleNavigationWidth,
    navigationMax,
  } = useWorkspaceLayout();
  const [suggestion, setSuggestion] = useState<{ text: string; at: number }>();
  // The earlier message the next one quotes, in the open session only.
  const [quoting, setQuoting] = useState<Quote & { sessionId: string }>();
  const quote =
    quoting && quoting.sessionId === sessionId ? quoting : undefined;
  const handoffQuery = useHandoffs();
  const handoffs = handoffQuery.data?.items;
  // A handoff is saved inside its tool call, so once a tool step completes or
  // a turn settles the list has it. Refetch then, rather than waiting for the
  // next poll, so its card arrives with the reply.
  const handoffSignal = [
    ...(data?.turns ?? []).map((turn) => `${turn.id}:${turn.status}`),
    (data?.activity ?? []).filter((event) => event.type === "tool.completed")
      .length,
  ].join("|");
  useEffect(() => {
    void queries.invalidateQueries({ queryKey: ["handoffs"] });
  }, [handoffSignal, queries]);
  const [enabled, setEnabled] = useEnabledPlugins();
  // A bot without a model asks for one instead of offering an empty chat.
  const needsSetup = useNeedsSetup();
  // A fresh install, one bot without a model and nothing said yet, starts
  // with onboarding; skipping it shows the bot's own setup instead.
  const [skippedOnboarding, setSkippedOnboarding] = useState(false);
  const mobile = useIsMobile();
  // A phone opens on your team; this is the chosen bot's chat, open before
  // its first message gives it an address.
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    if (sessionId) setComposing(false);
  }, [sessionId]);
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
  const contextUsed = data
    ? contextTokens(
        data.turns
          .filter((t) => t.conversationId === conversationId)
          .map((t) => t.id),
        data.activity,
      )
    : undefined;
  const readSessionId = conversation?.sessionId;
  const readCount = conversation?.replyCount ?? 0;
  const markInboxRead = inbox.markRead;
  const markRead = useCallback(() => {
    if (readSessionId) markInboxRead(workspace.botId, readSessionId, readCount);
  }, [markInboxRead, workspace.botId, readSessionId, readCount]);
  useEffect(() => {
    if (readSessionId)
      writeLocal(lastSessionKey(workspace.url, workspace.botId), readSessionId);
  }, [workspace.url, workspace.botId, readSessionId]);

  async function send(
    text: string,
    eventId: string,
    model?: ModelSelection,
    attachments?: string[],
    approvalMode?: "ask" | "full-access",
  ) {
    const sent = await api<{
      id: string;
      sessionId: string;
    }>("/api/sessions/messages", {
      text,
      attachments,
      eventId,
      sessionId: conversationId,
      approvalMode,
      model,
      ...(quote
        ? { quote: { turnId: quote.turnId, author: quote.author } }
        : {}),
    });
    setSuggestion(undefined);
    setQuoting(undefined);
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
    setComposing(!id && mobile && !nextView);
    // An archived conversation is not among the summaries; its id is its
    // session id.
    const selected = summaries.find((c) => c.id === id)?.sessionId ?? id;
    if (selected)
      void navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: selected },
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

  // The chat is named by its bot; any other session by its own title.
  const title =
    conversation && !conversation.chat
      ? conversation.title
      : missing
        ? "Conversation unavailable"
        : undefined;
  const settings = view === "settings";

  // On a phone your team is a screen of its own, until a bot is chosen.
  const listScreen =
    mobile && !view && !sessionId && !legacyConversationId && !composing;
  // A bot opens on its chat, once it has one.
  const chatId = chat?.sessionId;
  useEffect(() => {
    if (view || sessionId || legacyConversationId || listScreen || !chatId)
      return;
    void navigate({
      to: "/sessions/$sessionId",
      params: { sessionId: chatId },
      search: { bot },
      replace: true,
    });
  }, [
    view,
    sessionId,
    legacyConversationId,
    listScreen,
    chatId,
    navigate,
    bot,
  ]);
  const roster = (
    <BotSidebar
      bots={inbox.bots.data?.items ?? []}
      botId={workspace.botId}
      byBot={inbox.byBot}
      unread={inbox.unread}
      connected={connected}
      error={!!inbox.bots.error}
      onRetry={() => void inbox.bots.refetch()}
      needsSetup={needsSetup}
      onOpen={(botId, id) =>
        void navigate({
          to: "/sessions/$sessionId",
          params: { sessionId: id },
          search: { bot: botId === "default" ? undefined : botId },
        })
      }
      onSelect={(id) => {
        // Choosing a teammate opens its chat.
        setComposing(mobile);
        void navigate({
          to: "/",
          search: { bot: id === "default" ? undefined : id },
        });
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
            onChange={resizePanel}
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
                skill={skill}
                enabled={enabled}
                setEnabled={setEnabled}
                traces={<Diagnostics bots={inbox.bots.data?.items ?? []} />}
                activity={<BotActivity />}
                onParent={(next) => selectSettings(workspace.botId, next)}
              />
            </SettingsMain>
          ) : (
            <>
              {listScreen ? (
                roster
              ) : view === "notifications" ? (
                <header className="workspace-header notifications-global-header">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Back to conversation"
                    title="Back to conversation"
                    onClick={() => {
                      if (sessionId)
                        void navigate({
                          to: "/sessions/$sessionId",
                          params: { sessionId },
                          search: { bot },
                        });
                      else select(conversationId);
                    }}
                  >
                    <ArrowLeft size={16} />
                  </Button>
                  <strong>Inbox</strong>
                  <span>All bots</span>
                </header>
              ) : (
                <WorkspaceHeader
                  title={title}
                  breadcrumb={botProfile?.name ?? "Raphie"}
                  botId={workspace.botId}
                  description={
                    botProfile?.description ?? "Your personal assistant"
                  }
                  onBack={view ? () => select(conversationId) : undefined}
                  onList={
                    mobile && !view
                      ? () => {
                          setComposing(false);
                          void navigate({ to: "/", search: { bot } });
                        }
                      : undefined
                  }
                  onBotSettings={() => openSettings("bot")}
                  notificationCount={notificationCount}
                  onNotifications={() =>
                    void navigate({
                      to: sessionId ? "/sessions/$sessionId" : "/",
                      ...(sessionId ? { params: { sessionId } } : {}),
                      search: { bot, view: "notifications" },
                    })
                  }
                  collapsed={collapsed}
                  onToggleNavigation={toggleCollapsed}
                />
              )}
              {listScreen ? null : view === "notifications" ? (
                <Notifications
                  items={notifications}
                  jobs={jobNotifications}
                  count={notificationCount}
                  onOpen={(botId, id, turnId) =>
                    void navigate({
                      to: "/sessions/$sessionId",
                      params: { sessionId: id },
                      search: {
                        bot: botId === "default" ? undefined : botId,
                        message: turnId,
                      },
                    })
                  }
                />
              ) : error ? (
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
                  description="This link doesn’t match a session in the current workspace."
                  icon="missing"
                  onAction={() => select()}
                  action="Go to the chat"
                />
              ) : (
                <>
                  {needsSetup && !conversation ? (
                    <BotSetup
                      botId={workspace.botId}
                      name={botProfile?.name ?? "Raphie"}
                      onProviders={() => openSettings("providers")}
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
                          onRead={markRead}
                          handoffs={handoffs}
                          bots={notificationBots}
                          skills={skillNames}
                          author={{
                            name: botProfile?.name ?? "Raphie",
                            avatar: <BotAvatar id={workspace.botId} />,
                          }}
                          onCancelHandoff={(id) =>
                            handoffQuery.cancel.mutateAsync(id)
                          }
                          reveal={message}
                          onQuote={
                            conversation.history
                              ? undefined
                              : (next) =>
                                  setQuoting({
                                    ...next,
                                    sessionId: conversation.sessionId,
                                  })
                          }
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
                      {conversation?.history ? (
                        <HistoryNotice onChat={() => select()} />
                      ) : (
                        <Composer
                          key={`composer-${conversationId ?? "new"}`}
                          handoffs={handoffs}
                          mentionables={handoffQuery.data?.targets}
                          handedOffBy={conversation?.handedOffBy}
                          conversationId={conversationId}
                          suggestion={suggestion}
                          model={conversation?.model ?? data?.model ?? null}
                          needsModel={!data?.model}
                          usage={usage?.tokens ? usage : undefined}
                          contextUsed={contextUsed}
                          disabled={
                            !connected ||
                            !data?.model ||
                            (!!conversationId && !conversation)
                          }
                          busy={busy}
                          enabledPlugins={enabled}
                          onStop={async () => {
                            if (!conversationId) return;
                            await api(
                              `/api/sessions/${conversationId}/control`,
                              {
                                action: "stop",
                              },
                            );
                            await refetch();
                          }}
                          onSend={send}
                          quote={quote}
                          onClearQuote={() => setQuoting(undefined)}
                          onManageSkills={() =>
                            void navigate({
                              to: "/",
                              search: {
                                bot,
                                view: "settings",
                                section: "skills",
                              },
                            })
                          }
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
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
  const teamSize = inbox.bots.data?.items.length ?? 0;
  const flow: TeammateFlowMode | undefined =
    view === "settings" && section === "new-bot"
      ? { kind: "new" }
      : botProfile &&
          showsOnboarding({
            loaded: !!data,
            needsSetup,
            conversations: summaries.length,
            settingsOpen: !!view,
            skipped: skippedOnboarding,
          })
        ? { kind: teamSize === 1 ? "first" : "setup", bot: botProfile }
        : undefined;
  // A teammate joins through one flow, the first or any later one; it takes
  // the window until the bot can reply or the owner leaves it.
  if (flow)
    return (
      <BotTonesProvider bots={inbox.bots.data?.items ?? []}>
        <TeammateFlow
          key={flow.kind === "new" ? "new" : flow.bot.id}
          mode={flow}
          onProviders={() => openSettings("providers")}
          onClose={() =>
            flow.kind === "new"
              ? select(conversationId)
              : setSkippedOnboarding(true)
          }
          onCreated={(id) => void navigate({ to: "/", search: { bot: id } })}
        />
      </BotTonesProvider>
    );
  return (
    <BotTonesProvider bots={inbox.bots.data?.items ?? []}>
      {content}
    </BotTonesProvider>
  );
}

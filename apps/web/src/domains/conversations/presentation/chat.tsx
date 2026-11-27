import type { Handoff, Quote } from "@raphie/contracts";
import { useChat } from "@tanstack/ai-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CircleAlert,
  CornerUpRight,
  ListEnd,
} from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Snapshot } from "../../../infrastructure/http/api-client";
import { useBackend } from "../../../infrastructure/http/backend-context";
import { ToolSteps } from "../../approvals/presentation/tool-steps";
import {
  formatCost,
  runUsage,
  type ToolStep,
  toolSteps,
} from "../application/run-projection";
import { chatAdapter } from "../infrastructure/chat-adapter";
import { ActiveRun } from "./active-run";
import { AskMarker } from "./ask-marker";
import { AttachmentCard } from "./attachment-card";
import { BackgroundMarkers } from "./background-requests";
import { CompactionDivider } from "./compaction-divider";
import { Conversation } from "./conversation";
import {
  HandoffBrief,
  HandoffCards,
  HandoffResult,
  HandoffSources,
} from "./handoffs/handoff-cards";
import {
  mentionComponents,
  remarkMentions,
  remarkSkills,
} from "./handoffs/mention-markdown";
import { messageId, QuoteAction, QuoteBar, showMessage } from "./quote";
import { ReplyActions } from "./reply-actions";
import { SelfUpdateNotes } from "./self-update-notes";
import { ShownCard } from "./shown-card";
import { WorkTab } from "./work-tab";

const noBots: readonly { id: string; name: string }[] = [];
const noSkills: readonly string[] = [];

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

type Turn = Snapshot["turns"][number];

/**
 * Consecutive failed runs of one scheduled job read as one failure: the
 * latest says how many attempts there were, and the earlier ones are hidden.
 */
function failedRuns(turns: Turn[]) {
  const runs = new Map<string, { count: number; first: number } | "hidden">();
  let group: Turn[] = [];
  const close = () => {
    group.forEach((turn, i) =>
      runs.set(
        turn.id,
        i === group.length - 1
          ? { count: group.length, first: group[0].createdAt }
          : "hidden",
      ),
    );
    group = [];
  };
  for (const turn of turns) {
    const failed = turn.scheduled && turn.status === "error" && !turn.cancelled;
    if (!failed || group[0]?.scheduled?.name !== turn.scheduled?.name) close();
    if (failed) group.push(turn);
  }
  close();
  return runs;
}

export function Chat({
  state,
  conversationId,
  onRead,
  handoffs: handoffItems = [],
  onCancelHandoff,
  bots = noBots,
  skills = noSkills,
  author,
  onQuote,
  onOpenWorkItem,
  reveal,
}: {
  /** The bot replying here: its name and avatar sign each reply. */
  author: { name: string; avatar: ReactNode };
  state: Snapshot;
  conversationId: string;
  onRead?: () => void;
  /** This bot's handoffs. Queried by the workspace: a query here would feed
      back into the live chat adapter, which republishes on cache events. */
  handoffs?: readonly Handoff[];
  onCancelHandoff?: (id: string) => Promise<unknown>;
  /** Every bot, so "@Name" shows as the bot it names. */
  bots?: readonly { id: string; name: string }[];
  /** This bot's skills, so a message starting "/name" shows the skill. */
  skills?: readonly string[];
  /** Quotes a message in the next one the owner sends. */
  onQuote?: (quote: Quote) => void;
  /** A turn whose message to bring into view once it is shown. */
  reveal?: string;
  /** Opens a work item on the bot's Work page. */
  onOpenWorkItem?: (itemId: string) => void;
}) {
  const mentions = useMemo(
    () => ({
      components: mentionComponents(bots),
      plugins: [remarkGfm, remarkMentions(bots), remarkSkills(skills)],
    }),
    [bots, skills],
  );
  const query = useQueryClient();
  const { workspace } = useBackend();
  const [controlError, setControlError] = useState<string>();

  async function control(action: "steer" | "queue" | "stop", turnId?: string) {
    setControlError(undefined);
    try {
      await workspace.api(`/api/sessions/${conversationId}/control`, {
        action,
        turnId,
      });
      await query.invalidateQueries({ queryKey: ["session", conversationId] });
    } catch {
      setControlError(
        "This message could not be changed. It may already have been picked up.",
      );
    }
  }

  const connection = useMemo(
    () =>
      chatAdapter(
        conversationId,
        (listener) => {
          const publish = () => {
            const current = query.getQueryData<Snapshot>(["runtime"]);
            if (current) listener(current);
          };
          publish();
          return query.getQueryCache().subscribe(publish);
        },
        workspace.api,
      ),
    [conversationId, query, workspace],
  );
  const { messages } = useChat({
    connection,
    live: true,
    threadId: conversationId,
  });
  const turns = state.turns.filter((t) => t.conversationId === conversationId);
  // Brought into view once, when its message first shows.
  const revealed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!reveal || revealed.current === reveal) return;
    if (showMessage(reveal, "bot") || showMessage(reveal, "owner"))
      revealed.current = reveal;
  }, [reveal, messages.length]);
  const steps = useMemo(() => {
    const approvals = state.toolApprovals.filter(
      (a) => a.conversationId === conversationId,
    );
    const byTurn = new Map<string, ToolStep[]>(
      turns.map((t) => [
        t.id,
        // A question shows as its own card, not as a tool step.
        toolSteps(t.id, state.activity, approvals).filter(
          (step) => step.tool !== "ask_owner",
        ),
      ]),
    );
    // The journal is capped; approvals whose events rolled off still belong to
    // the turn that was active when they were requested.
    const shown = new Set(
      [...byTurn.values()].flat().flatMap((s) => s.approval?.id ?? []),
    );
    for (const approval of approvals) {
      if (shown.has(approval.id)) continue;
      const turn = turns.findLast((t) => t.createdAt <= approval.createdAt);
      byTurn.get(turn?.id ?? "")?.push({
        id: approval.id,
        server: approval.server,
        tool: approval.tool,
        startedAt: approval.createdAt,
        approval,
      });
    }
    return byTurn;
  }, [turns, state.activity, state.toolApprovals, conversationId]);

  const asks = state.asks.filter((a) => a.conversationId === conversationId);
  const cards = state.cards.filter((c) => c.conversationId === conversationId);
  const runs = failedRuns(turns);
  // A turn with a reply shows its tool work under the reply, signed by the
  // bot; one without (stopped, failed or still working) shows it in place.
  const replied = new Set(
    messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.id.replace(/:reply$/, "")),
  );
  // An excerpt as the runtime keeps it, so the composer shows what is sent.
  const quoteOf = (turnId: string, author: Quote["author"], text: string) => ({
    turnId,
    author,
    excerpt: text.trim().replace(/\s+/g, " ").slice(0, 280),
  });
  /** Opens a work item on the Work page, when the workspace can. */
  const openItem = (id: string | undefined) =>
    id && onOpenWorkItem ? () => onOpenWorkItem(id) : undefined;
  const signature = (at?: number, title?: string) => (
    <header className="message-author">
      {author.avatar}
      <strong>{author.name}</strong>
      {at && (
        <time dateTime={new Date(at).toISOString()} title={title}>
          {time(at)}
        </time>
      )}
    </header>
  );

  return (
    <Conversation onRead={onRead}>
      {controlError && (
        <p className="error" role="alert">
          {controlError}
        </p>
      )}
      {messages.map((message) => {
        const turnId = message.id.replace(/:reply$/, "");
        const turn = turns.find((t) => t.id === turnId);
        // Above the turn whose run summarized the messages before it.
        const divider = turn?.compaction && (
          <CompactionDivider compaction={turn.compaction} />
        );
        const text = message.parts
          .flatMap((p) => (p.type === "text" ? [p.content] : []))
          .join("");
        if (message.role === "user" && turn?.handoff)
          return (
            <div key={message.id} className="turn-user">
              {divider}
              {turn.handoff.kind === "task" ? (
                <HandoffBrief
                  handoff={turn.handoff}
                  text={turn.text}
                  at={turn.createdAt}
                  followUp={turns.some(
                    (other) =>
                      other.handoff?.kind === "task" &&
                      other.createdAt < turn.createdAt,
                  )}
                />
              ) : (
                <HandoffResult
                  handoff={turn.handoff}
                  text={turn.text}
                  at={turn.createdAt}
                  record={handoffItems.find(
                    (item) => item.id === turn.handoff?.id,
                  )}
                />
              )}
              {turnWork(turn, steps.get(turn.id) ?? [])}
            </div>
          );
        if (message.role === "user" && turn?.scheduled && runs.has(turn.id)) {
          const run = runs.get(turn.id);
          return run === "hidden" || !run ? null : (
            <div key={message.id} className="turn-user">
              {divider}
              <ScheduledFailure
                turn={turn}
                attempts={run.count}
                first={run.first}
                signature={signature(turn.createdAt)}
              />
            </div>
          );
        }
        // A work item's run (background work's result or a scheduled job's
        // post) was not written by the owner: only the bot's reply shows,
        // under its provenance tab, and what became of the turn.
        if (message.role === "user" && turn && (turn.work || turn.scheduled))
          return turn.status !== "pending" && !replied.has(turn.id) ? (
            // It ended with no reply (failed or stopped): its tab still says
            // which work it was, and a quote or notice can find it here.
            <div
              key={message.id}
              className="work-unanswered"
              id={messageId(turn.id, "bot")}
            >
              {divider}
              <WorkTab turn={turn} onOpen={openItem(turn.work?.itemId)} />
              {turnWork(turn, steps.get(turn.id) ?? [])}
            </div>
          ) : (
            <Fragment key={message.id}>
              {divider}
              {turnWork(turn, steps.get(turn.id) ?? [])}
            </Fragment>
          );
        if (message.role === "user")
          return (
            <div key={message.id} className="turn-user">
              {divider}
              <article
                className="message message-user"
                id={turn ? messageId(turn.id, "owner") : undefined}
                data-queued={turn?.queueMode ? true : undefined}
              >
                {turn?.quote && (
                  <QuoteBar quote={turn.quote} botName={author.name} />
                )}
                <div className="markdown">
                  <ReactMarkdown
                    components={mentions.components}
                    remarkPlugins={mentions.plugins}
                  >
                    {text}
                  </ReactMarkdown>
                </div>
                {turn?.attachments?.length ? (
                  <ul
                    className="message-attachments"
                    aria-label="Message attachments"
                  >
                    {turn.attachments.map((file) => (
                      <li key={file.id}>
                        <AttachmentCard
                          file={file}
                          workspace={workspace}
                          onError={() =>
                            setControlError(
                              "Could not download this attachment. Please retry.",
                            )
                          }
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {turn && (
                  <time dateTime={new Date(turn.createdAt).toISOString()}>
                    {time(turn.createdAt)}
                  </time>
                )}
                {turn && onQuote && text.trim() && !turn.queueMode && (
                  <QuoteAction
                    onQuote={() => onQuote(quoteOf(turn.id, "owner", text))}
                  />
                )}
              </article>
              {turn?.queueMode && (
                <div className="message-queue-controls">
                  <span>
                    {turn.queueMode === "steer"
                      ? "Steering after this step"
                      : "Queued"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void control(
                        turn.queueMode === "steer" ? "queue" : "steer",
                        turn.id,
                      );
                    }}
                  >
                    {turn.queueMode === "steer" ? (
                      <ListEnd size={14} aria-hidden="true" />
                    ) : (
                      <CornerUpRight size={14} aria-hidden="true" />
                    )}
                    {turn.queueMode === "steer" ? "Keep queued" : "Steer"}
                  </button>
                </div>
              )}
              {turn && turnWork(turn, steps.get(turn.id) ?? [])}
            </div>
          );
        const usage = turn && runUsage(turn.id, state.activity);
        // A job's post has no model call: it was said when it was posted.
        const at =
          state.activity.findLast(
            (e) => e.runId === turnId && e.type === "model.completed",
          )?.at ?? (turn?.work || turn?.scheduled ? turn.createdAt : undefined);
        const itemId = turn?.work?.itemId;
        const turnSteps = (turn && steps.get(turn.id)) ?? [];
        return (
          <article
            key={message.id}
            className="message message-assistant"
            id={turn ? messageId(turn.id, "bot") : undefined}
          >
            {turn?.status === "done" && signature()}
            {turn && (turn.work || turn.scheduled) && (
              <WorkTab turn={turn} onOpen={openItem(itemId)} />
            )}
            {turn && (
              <HandoffCards
                turnId={turn.id}
                handoffs={handoffItems}
                onCancel={(id) => onCancelHandoff?.(id) ?? Promise.resolve()}
              />
            )}
            <div className="markdown">
              <ReactMarkdown
                components={mentions.components}
                remarkPlugins={mentions.plugins}
              >
                {text}
              </ReactMarkdown>
            </div>
            {turn?.status === "done" &&
              cards
                .filter((c) => c.turnId === turnId)
                .map((shown) => <ShownCard key={shown.id} shown={shown} />)}
            {turn?.status === "done" && (
              <HandoffSources read={turn.readSessions ?? []} />
            )}
            {turn?.status === "done" && turnSteps.length > 0 && (
              <ToolSteps steps={turnSteps} working={false} decide={false} />
            )}
            {turn?.status === "done" && <SelfUpdateNotes steps={turnSteps} />}
            {/* Copy and Reply take the whole reply, so they sit under it,
                with when it was said. */}
            {turn?.status === "done" && text.trim() && (
              <ReplyActions
                text={text}
                at={at}
                time={at ? time(at) : undefined}
                title={
                  // Tokens and cost are for the curious, not the conversation.
                  usage
                    ? `${usage.tokens.toLocaleString()} tokens across ${usage.calls} model ${usage.calls === 1 ? "call" : "calls"} · ${formatCost(usage.cost)}, provider-reported`
                    : undefined
                }
                onReply={
                  onQuote
                    ? () => onQuote(quoteOf(turn.id, "bot", text))
                    : undefined
                }
              />
            )}
          </article>
        );
      })}
      {turns
        .filter((t) => t.status === "pending" && !t.queueMode)
        .map((turn) => (
          <ActiveRun
            key={turn.id}
            turn={turn}
            state={state}
            steps={steps.get(turn.id) ?? []}
            asks={asks.filter((a) => a.turnId === turn.id)}
            cards={cards.filter((c) => c.turnId === turn.id)}
            title={author.name}
          />
        ))}
      <BackgroundMarkers requests={state.background ?? []} />
    </Conversation>
  );

  // A plain render helper, not a component: a component declared here would
  // remount on every snapshot and collapse open step details.
  function turnWork(turn: Snapshot["turns"][number], steps: ToolStep[]) {
    const working = turn.status === "pending";
    const inReply = turn.status === "done" && replied.has(turn.id);
    return (
      <>
        {!working && !inReply && steps.length > 0 && (
          <ToolSteps steps={steps} working={working} decide={false} />
        )}
        {!working && !inReply && <SelfUpdateNotes steps={steps} />}
        {!working &&
          asks
            .filter((a) => a.turnId === turn.id)
            .map((ask) => (
              <AskMarker key={ask.id} ask={ask} title={author.name} />
            ))}
        {!working &&
          !inReply &&
          cards
            .filter((c) => c.turnId === turn.id)
            .map((shown) => <ShownCard key={shown.id} shown={shown} />)}
        {turn.cancelled && (
          <p className="message-meta">Stopped · message not completed</p>
        )}
        {turn.status === "error" && !turn.cancelled && (
          <div className="turn-failure" role="alert">
            {signature(turn.createdAt)}
            <p className="turn-error">
              <CircleAlert size={14} className="turn-error-icon" />
              <span>
                I couldn’t finish this reply.{" "}
                {turn.failure?.message ??
                  "Check Diagnostics, then send a new message to retry."}
              </span>
            </p>
            {turn.failure?.detail && (
              <details className="turn-error-more">
                <summary>Details</summary>
                <pre className="turn-error-detail">{turn.failure.detail}</pre>
              </details>
            )}
          </div>
        )}
      </>
    );
  }
}

/** A scheduled job that failed, once or several times in a row, said once. */
function ScheduledFailure({
  turn,
  attempts,
  first,
  signature,
}: {
  turn: Turn;
  attempts: number;
  first: number;
  signature: ReactNode;
}) {
  const name = turn.scheduled?.name ?? "A scheduled job";
  return (
    <div className="turn-failure" role="alert">
      {signature}
      <p className="turn-error-lede">
        I couldn’t run <strong>{name}</strong>
        {attempts > 1 ? `, after ${attempts} tries.` : "."}
      </p>
      <div className="turn-failure-card">
        <CalendarClock size={14} aria-hidden="true" />
        <span>
          <strong>{name} didn’t run</strong>
          <small>
            {attempts > 1
              ? time(first) === time(turn.createdAt)
                ? `${attempts} attempts at ${time(first)}`
                : `${attempts} attempts, ${time(first)} to ${time(turn.createdAt)}`
              : `Due ${time(turn.createdAt)}`}
            {turn.failure?.message ? ` · ${turn.failure.message}` : ""}
          </small>
        </span>
      </div>
      {turn.failure?.detail && (
        <details className="turn-error-more">
          <summary>Details</summary>
          <pre className="turn-error-detail">{turn.failure.detail}</pre>
        </details>
      )}
    </div>
  );
}

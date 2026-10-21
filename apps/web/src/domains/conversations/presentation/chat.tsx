import { useChat } from "@tanstack/ai-react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Snapshot } from "../../../infrastructure/http/api-client";
import { ToolSteps } from "../../approvals/presentation/tool-steps";
import {
  formatCost,
  formatTokens,
  runUsage,
  type ToolStep,
  toolSteps,
} from "../application/run-projection";
import { chatAdapter } from "../infrastructure/chat-adapter";
import { ActiveRun } from "./active-run";
import { Conversation } from "./conversation";
import { markdownComponents } from "./markdown-components";

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

export function Chat({
  state,
  conversationId,
}: {
  state: Snapshot;
  conversationId: string;
}) {
  const query = useQueryClient();
  const connection = useMemo(
    () =>
      chatAdapter(conversationId, (listener) => {
        const publish = () => {
          const current = query.getQueryData<Snapshot>(["runtime"]);
          if (current) listener(current);
        };
        publish();
        return query.getQueryCache().subscribe(publish);
      }),
    [conversationId, query],
  );
  const { messages } = useChat({ connection, live: true });
  const turns = state.turns.filter((t) => t.conversationId === conversationId);
  const steps = useMemo(() => {
    const approvals = state.toolApprovals.filter(
      (a) => a.conversationId === conversationId,
    );
    const byTurn = new Map<string, ToolStep[]>(
      turns.map((t) => [t.id, toolSteps(t.id, state.activity, approvals)]),
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

  return (
    <Conversation>
      {messages.map((message) => {
        const turnId = message.id.replace(/:reply$/, "");
        const turn = turns.find((t) => t.id === turnId);
        const text = message.parts
          .flatMap((p) => (p.type === "text" ? [p.content] : []))
          .join("");
        if (message.role === "user")
          return (
            <div key={message.id} className="turn-user">
              <article className="message message-user">
                <div className="markdown">
                  <ReactMarkdown
                    components={markdownComponents}
                    remarkPlugins={[remarkGfm]}
                  >
                    {text}
                  </ReactMarkdown>
                </div>
                {turn && (
                  <time dateTime={new Date(turn.createdAt).toISOString()}>
                    {time(turn.createdAt)}
                  </time>
                )}
              </article>
              {turn && turnWork(turn, steps.get(turn.id) ?? [])}
            </div>
          );
        const usage = turn && runUsage(turn.id, state.activity);
        const at = state.activity.findLast(
          (e) => e.runId === turnId && e.type === "model.completed",
        )?.at;
        return (
          <article key={message.id} className="message message-assistant">
            <div className="markdown">
              <ReactMarkdown
                components={markdownComponents}
                remarkPlugins={[remarkGfm]}
              >
                {text}
              </ReactMarkdown>
            </div>
            {turn?.status === "done" && (
              <footer className="message-meta">
                {at && (
                  <time
                    dateTime={new Date(at).toISOString()}
                    title={new Date(at).toISOString()}
                  >
                    {time(at)}
                  </time>
                )}
                {usage && (
                  <span
                    title={`${usage.tokens.toLocaleString()} tokens across ${usage.calls} model ${usage.calls === 1 ? "call" : "calls"}, provider-reported`}
                  >
                    {formatTokens(usage.tokens)} tokens ·{" "}
                    {formatCost(usage.cost)}
                  </span>
                )}
              </footer>
            )}
          </article>
        );
      })}
      {turns
        .filter((t) => t.status === "pending")
        .map((turn) => (
          <ActiveRun
            key={turn.id}
            turn={turn}
            state={state}
            steps={steps.get(turn.id) ?? []}
          />
        ))}
    </Conversation>
  );

  // A plain render helper, not a component: a component declared here would
  // remount on every snapshot and collapse open step details.
  function turnWork(turn: Snapshot["turns"][number], steps: ToolStep[]) {
    const working = turn.status === "pending";
    return (
      <>
        {!working && steps.length > 0 && (
          <ToolSteps steps={steps} working={working} />
        )}
        {turn.status === "error" && (
          <p className="error turn-error" role="alert">
            <CircleAlert size={14} /> Raphie could not complete this reply.
            Check Diagnostics, then send a new message to retry.
          </p>
        )}
      </>
    );
  }
}

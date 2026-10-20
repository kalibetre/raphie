import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useChat } from "@tanstack/ai-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, LoaderCircle } from "lucide-react";
import { chatAdapter } from "../lib/chat-adapter";
import type { Snapshot } from "../lib/api";
import { Conversation } from "./ai-elements/conversation";
import { ApprovalCard } from "./approval-card";

export function Chat({
  state,
  conversationId,
}: {
  state: Snapshot;
  conversationId: number;
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
  const pending = turns.some((t) => t.status === "pending");
  const proposals = state.toolApprovals.filter(
    (p) => p.conversationId === conversationId,
  );
  return (
    <Conversation>
      <div className="conversation-date">
        {new Date(
          state.conversations.find((c) => c.id === conversationId)!.createdAt,
        ).toLocaleDateString(undefined, {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
      </div>
      {messages.map((message) => {
        const text = message.parts
          .flatMap((p) => (p.type === "text" ? [p.content] : []))
          .join("");
        const turnId = message.id.replace(/:reply$/, "");
        const turn = turns.find((t) => t.id === turnId);
        const at =
          message.role === "assistant"
            ? (state.activity.findLast(
                (e) => e.runId === turnId && e.type === "model.completed",
              )?.at ?? turn?.createdAt)
            : turn?.createdAt;
        return (
          <article
            key={message.id}
            className={`message message-${message.role}`}
          >
            <div className="message-avatar" aria-hidden="true">
              {message.role === "user" ? "K" : "r"}
            </div>
            <div className="message-body">
              <div className="message-heading">
                <strong>{message.role === "user" ? "You" : "Raphie"}</strong>
                {at && (
                  <time
                    title={new Date(at).toISOString()}
                    dateTime={new Date(at).toISOString()}
                  >
                    {new Date(at).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                )}
              </div>
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {text}
                </ReactMarkdown>
              </div>
              {message.role === "assistant" && turn?.status === "done" && (
                <span className="message-complete">
                  <Check size={12} /> Completed
                </span>
              )}
            </div>
          </article>
        );
      })}
      {proposals.map((item) => (
        <ApprovalCard key={item.id} item={item} />
      ))}
      {turns
        .filter((t) => t.status === "error")
        .map((t) => (
          <p className="error" role="alert" key={t.id}>
            Raphie could not complete this reply. Check Diagnostics, then send a
            new message to retry.
          </p>
        ))}
      {pending && (
        <div className="working" role="status">
          <LoaderCircle size={15} className="spin" />
          {proposals.some((p) => p.status === "pending")
            ? "Waiting for your approval"
            : "Raphie is working…"}
        </div>
      )}
    </Conversation>
  );
}

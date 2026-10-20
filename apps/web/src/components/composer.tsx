import { useEffect, useRef, useState } from "react";
import { ArrowUp, CornerDownLeft } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { readLocal, writeLocal } from "../lib/storage";
import { ComposerPlugins } from "../plugins";

export function Composer({
  conversationId,
  suggestion,
  model,
  disabled,
  busy,
  enabledPlugins,
  onSend,
}: {
  conversationId?: number;
  suggestion?: { text: string; at: number };
  model: string | null;
  disabled: boolean;
  busy: boolean;
  enabledPlugins: string[];
  onSend: (text: string, eventId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<{ text: string; id: string } | undefined>(undefined);
  const key = `raphie:draft:${conversationId ?? "new"}`;
  useEffect(() => {
    setDraft(readLocal(key) ?? "");
    setError(undefined);
    request.current = undefined;
  }, [key]);
  useEffect(() => {
    if (suggestion) {
      setDraft(suggestion.text);
      writeLocal(key, suggestion.text);
    }
  }, [suggestion, key]);
  function update(text: string) {
    setDraft(text);
    writeLocal(key, text);
  }
  async function send() {
    if (!draft.trim() || sending || disabled || busy) return;
    setSending(true);
    setError(undefined);
    if (request.current?.text !== draft)
      request.current = { text: draft, id: crypto.randomUUID() };
    try {
      await onSend(draft, request.current.id);
      update("");
      request.current = undefined;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Message could not be sent. Your draft is saved.",
      );
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="composer-wrap">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Textarea
          aria-label="Message Raphie"
          placeholder="Message Raphie…"
          value={draft}
          maxLength={4000}
          onChange={(event) => update(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-meta">
            <span className="model-dot" />
            {model?.split("/").at(-1) ?? "Model not configured"}
            <span className="plugin-divider" />
            <ComposerPlugins
              enabled={enabledPlugins}
              context={{ draft, model }}
            />
          </div>
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={disabled || busy || sending || !draft.trim()}
          >
            <ArrowUp />
          </Button>
        </div>
      </form>
      <div className="composer-hint">
        <span>
          {busy
            ? "Raphie is working. You can leave this conversation and return."
            : "Actions that use connected tools ask for your approval."}
        </span>
        <span>
          <CornerDownLeft size={12} /> Send
        </span>
      </div>
    </div>
  );
}

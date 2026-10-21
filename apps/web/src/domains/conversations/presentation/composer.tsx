import { ArrowUp, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  readLocal,
  writeLocal,
} from "../../../infrastructure/preferences/storage";
import { Button } from "../../../shared/ui/button";
import { Textarea } from "../../../shared/ui/textarea";
import { ComposerPlugins } from "../../settings/infrastructure/plugins/index";

export function Composer({
  conversationId,
  suggestion,
  model,
  usage,
  disabled,
  busy,
  enabledPlugins,
  onSend,
}: {
  conversationId?: string;
  suggestion?: { text: string; at: number };
  model: string | null;
  usage?: { tokens: number; cost: number };
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
          className="max-h-60 min-h-12 resize-none rounded-none border-0 bg-transparent px-0 pt-1 pb-2 text-[14.5px] leading-normal shadow-none focus-visible:ring-0 md:text-[14.5px] dark:bg-transparent"
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
          <span className="composer-chip" title={model ?? undefined}>
            <Sparkles size={13} />
            {model?.split("/").at(-1) ?? "No model"}
          </span>
          <ComposerPlugins
            enabled={enabledPlugins}
            context={{ draft, model, usage }}
          />
          <Button
            className="ml-auto size-[32px] rounded-full"
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={disabled || busy || sending || !draft.trim()}
          >
            <ArrowUp />
          </Button>
        </div>
      </form>
      <p className="composer-hint">
        {busy
          ? "Raphie is working. You can leave and come back."
          : "Tool actions ask for your approval · Enter to send, Shift+Enter for a new line"}
      </p>
    </div>
  );
}

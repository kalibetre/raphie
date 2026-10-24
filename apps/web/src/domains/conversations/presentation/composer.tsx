import type { ModelSelection } from "@raphie/contracts";
import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import {
  readLocal,
  writeLocal,
} from "../../../infrastructure/preferences/storage";
import { Button } from "../../../shared/ui/button";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { Textarea } from "../../../shared/ui/textarea";
import { ComposerPlugins } from "../../settings/infrastructure/plugins/index";
import { ModelPicker } from "./model-picker";
import { useComposerLayout } from "./use-composer-layout";

export function Composer({
  conversationId,
  suggestion,
  model,
  needsModel,
  usage,
  disabled,
  busy,
  enabledPlugins,
  onSend,
  onChooseModel,
  onModelSettings,
}: {
  conversationId?: string;
  suggestion?: { text: string; at: number };
  model: ModelSelection | null;
  needsModel: boolean;
  usage?: { tokens: number; cost: number };
  disabled: boolean;
  busy: boolean;
  enabledPlugins: string[];
  onSend: (
    text: string,
    eventId: string,
    model?: ModelSelection,
  ) => Promise<void>;
  onChooseModel: (model: ModelSelection) => Promise<void>;
  onModelSettings: () => void;
}) {
  const [newModel, setNewModel] = useState<ModelSelection>();
  const selectedForNewSession = conversationId ? undefined : newModel;
  const activeModel = selectedForNewSession ?? model;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<
    { text: string; id: string; modelKey: string } | undefined
  >(undefined);
  const { workspace } = useBackend();
  const key = workspace.draftKey(conversationId);
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

  const { wrapper, input, revealCaret } = useComposerLayout(draft);

  function update(text: string) {
    setDraft(text);
    writeLocal(key, text);
  }

  async function send() {
    if (!draft.trim() || sending || disabled || busy) return;
    setSending(true);
    setError(undefined);
    const modelKey = JSON.stringify(selectedForNewSession ?? null);
    if (
      request.current?.text !== draft ||
      request.current.modelKey !== modelKey
    )
      request.current = { text: draft, id: crypto.randomUUID(), modelKey };
    try {
      await onSend(draft, request.current.id, selectedForNewSession);
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
    <div className="composer-wrap" ref={wrapper}>
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
        <ScrollArea
          className="composer-input-scroll"
          viewportLabel="Message draft"
        >
          <Textarea
            ref={input}
            className="min-h-6 resize-none rounded-none border-0 bg-transparent px-0 py-0 text-[14.5px] leading-6 shadow-none focus-visible:ring-0 md:text-[14.5px] dark:bg-transparent"
            aria-label="Message Raphie"
            placeholder="Message Raphie…"
            value={draft}
            maxLength={4000}
            onSelect={revealCaret}
            onKeyUp={revealCaret}
            onPointerUp={revealCaret}
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
        </ScrollArea>
        <div className="composer-toolbar">
          <ModelPicker
            model={activeModel}
            disabled={busy || sending}
            onChoose={async (selected) => {
              if (conversationId) await onChooseModel(selected);
              else setNewModel(selected);
            }}
            onSettings={onModelSettings}
          />
          <ComposerPlugins
            enabled={enabledPlugins}
            context={{ draft, model: activeModel?.modelId ?? null, usage }}
          />
          <Button
            className="ml-auto size-8 rounded-full transition-[transform,opacity,background-color] duration-150 enabled:hover:scale-105 enabled:active:scale-95"
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={disabled || busy || sending || !draft.trim()}
          >
            <ArrowUp />
          </Button>
        </div>
      </form>
      {(needsModel || busy) && (
        <p
          className="composer-hint"
          data-warning={needsModel || undefined}
          role={needsModel ? "status" : undefined}
        >
          {needsModel
            ? "Connect a model in Settings to start chatting."
            : "Raphie is working. You can leave and come back."}
        </p>
      )}
    </div>
  );
}

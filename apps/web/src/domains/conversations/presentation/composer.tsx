import type { ModelSelection } from "@raphie/contracts";
import { useEffect, useRef, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import {
  readLocal,
  writeLocal,
} from "../../../infrastructure/preferences/storage";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { Textarea } from "../../../shared/ui/textarea";
import { ComposerPlugins } from "../../settings/infrastructure/plugins/index";
import { ComposerActions } from "./composer-actions";
import { AttachmentChips, ComposerAttachments } from "./composer-attachments";
import { McpPermissions } from "./mcp-permissions";
import { ModelPicker } from "./model-picker";
import { useComposerAttachments } from "./use-composer-attachments";
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
  onStop,
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
  onStop: () => Promise<void>;
  onSend: (
    text: string,
    eventId: string,
    model?: ModelSelection,
    attachments?: string[],
  ) => Promise<void>;
  onChooseModel: (model: ModelSelection) => Promise<void>;
  onModelSettings: () => void;
}) {
  const [newModel, setNewModel] = useState<ModelSelection>();
  const selectedForNewSession = conversationId ? undefined : newModel;
  const activeModel = selectedForNewSession ?? model;
  const [draft, setDraft] = useState("");
  const draftValue = useRef(draft);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<
    { text: string; id: string; modelKey: string } | undefined
  >(undefined);
  const { workspace } = useBackend();
  const key = workspace.draftKey(conversationId);
  const activeKey = useRef(key);
  useEffect(() => {
    activeKey.current = key;
  }, [key]);
  const {
    files,
    uploading,
    upload,
    save: saveFiles,
    removeSent,
  } = useComposerAttachments(key, setError);
  const hasContent = !!draft.trim() || files.length > 0;
  const locked = sending || uploading;
  useEffect(() => {
    const saved = readLocal(key) ?? "";
    setDraft(saved);
    draftValue.current = saved;
    setError(undefined);
    request.current = undefined;
  }, [key]);
  useEffect(() => {
    if (suggestion) {
      setDraft(suggestion.text);
      draftValue.current = suggestion.text;
      writeLocal(key, suggestion.text);
    }
  }, [suggestion, key]);

  const { wrapper, input, revealCaret } = useComposerLayout(draft);

  function update(text: string) {
    setDraft(text);
    draftValue.current = text;
    writeLocal(key, text);
  }

  async function stop() {
    setSending(true);
    setError(undefined);
    try {
      await onStop();
    } catch {
      setError("Could not stop this task. Please retry.");
    } finally {
      setSending(false);
    }
  }

  async function send() {
    if (!hasContent || locked || disabled) return;
    const sentKey = key;
    const sentDraft = draft;
    const sentFiles = files;
    setSending(true);
    setError(undefined);
    const modelKey = JSON.stringify([
      selectedForNewSession ?? null,
      files.map((f) => f.id),
    ]);
    if (
      request.current?.text !== draft ||
      request.current.modelKey !== modelKey
    )
      request.current = { text: draft, id: crypto.randomUUID(), modelKey };
    try {
      await onSend(
        sentDraft,
        request.current.id,
        selectedForNewSession,
        sentFiles.map((f) => f.id),
      );
      const sameDraft =
        activeKey.current === sentKey && draftValue.current === sentDraft;
      if (readLocal(sentKey) === sentDraft || sameDraft)
        writeLocal(sentKey, "");
      if (sameDraft) {
        setDraft("");
        draftValue.current = "";
      }
      removeSent(sentFiles, sentKey);
      if (activeKey.current === sentKey) request.current = undefined;
    } catch (error) {
      if (activeKey.current === sentKey)
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
      {conversationId && (
        <McpPermissions
          key={`${workspace.botId}:${conversationId}`}
          sessionId={conversationId}
        />
      )}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <AttachmentChips
          files={files}
          workspace={workspace}
          disabled={disabled || locked}
          onRemove={(id) => saveFiles(files.filter((f) => f.id !== id))}
        />
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
          <ComposerAttachments
            files={files}
            disabled={disabled || locked}
            onUpload={(selected) => {
              void upload(selected);
            }}
          />
          <ModelPicker
            model={activeModel}
            disabled={busy || locked}
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
          <ComposerActions
            busy={busy}
            hasContent={hasContent}
            sending={sending}
            uploading={uploading}
            disabled={disabled}
            onStop={() => {
              void stop();
            }}
          />
        </div>
      </form>
      {uploading && (
        <p className="composer-hint" role="status">
          Uploading to workspace…
        </p>
      )}
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

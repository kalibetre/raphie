import type { Handoff, ModelSelection } from "@raphie/contracts";
import { useEffect, useRef, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import {
  readLocal,
  writeLocal,
} from "../../../infrastructure/preferences/storage";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { Textarea } from "../../../shared/ui/textarea";
import { ComposerPlugins } from "../../settings/infrastructure/plugins/index";
import { useRuntimeSettings } from "../../settings/infrastructure/use-runtime-settings";
import { useSkills } from "../../settings/infrastructure/use-skills";
import { ComposerActions } from "./composer-actions";
import { AttachmentChips, ComposerAttachments } from "./composer-attachments";
import { ContextRing } from "./context-ring";
import { HandoffDelegates, HandoffNote } from "./handoffs/handoff-delegates";
import { useMentions } from "./handoffs/mention-menu";
import { McpPermissions } from "./mcp-permissions";
import { ModelPicker } from "./model-picker";
import { type SlashCommand, useSlashMenu } from "./slash-menu";
import { useComposerAttachments } from "./use-composer-attachments";
import { useComposerLayout } from "./use-composer-layout";

export function Composer({
  botName = "Raphie",
  conversationId,
  suggestion,
  model,
  needsModel,
  usage,
  contextUsed,
  disabled,
  busy,
  enabledPlugins,
  handoffs = [],
  mentionables = [],
  handedOffBy,
  onSend,
  onStop,
  onChooseModel,
  onModelSettings,
  onNewConversation,
  onManageSkills,
}: {
  /** The bot this conversation is with, named in the empty field. */
  botName?: string;
  conversationId?: string;
  suggestion?: { text: string; at: number };
  model: ModelSelection | null;
  needsModel: boolean;
  usage?: { tokens: number; cost: number };
  /** Tokens in the conversation's latest model call, for the context ring. */
  contextUsed?: number;
  disabled: boolean;
  busy: boolean;
  enabledPlugins: string[];
  /** This bot's handoffs; the ones this session started show in the toolbar. */
  handoffs?: readonly Handoff[];
  /** The other bots, offered when the owner types @ to hand a task to one. */
  mentionables?: readonly { id: string; name: string }[];
  /** The bot that handed this task off: the owner may continue it here. */
  handedOffBy?: { id: string; name: string; sessionId?: string };
  onStop: () => Promise<void>;
  onSend: (
    text: string,
    eventId: string,
    model?: ModelSelection,
    attachments?: string[],
    approvalMode?: "ask" | "full-access",
  ) => Promise<void>;
  onChooseModel: (model: ModelSelection) => Promise<void>;
  onModelSettings: () => void;
  /** The /new command: open a new conversation with this bot. */
  onNewConversation?: () => void;
  /** Opens this bot's Skills settings, from the / menu. */
  onManageSkills?: () => void;
}) {
  const [permission, setPermission] = useState<{
    key: string;
    mode: "ask" | "full-access";
  }>();
  const [newModel, setNewModel] = useState<ModelSelection>();
  const selectedForNewSession = conversationId ? undefined : newModel;
  const activeModel = selectedForNewSession ?? model;
  const contextWindow = useRuntimeSettings().data?.models.find(
    (m) =>
      m.id === activeModel?.modelId && m.connectionId === activeModel?.provider,
  )?.contextWindow;
  const [draft, setDraft] = useState("");
  const draftValue = useRef(draft);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<
    { text: string; id: string; modelKey: string } | undefined
  >(undefined);
  const { workspace } = useBackend();
  const key = workspace.draftKey(conversationId);
  const draftMode = permission?.key === key ? permission.mode : "ask";
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
  const mentions = useMentions({
    draft,
    // A handed-off task is done here, never handed on.
    bots: handedOffBy ? [] : mentionables,
    input,
    update,
  });

  const [modelRequest, setModelRequest] = useState(0);
  const skills = useSkills().list.data?.items ?? [];
  const commands: SlashCommand[] = [
    ...(onNewConversation
      ? [
          {
            kind: "command" as const,
            name: "new",
            description: "Start a new conversation",
            run: onNewConversation,
          },
        ]
      : []),
    {
      kind: "command",
      name: "model",
      description: "Choose the model for this conversation",
      run: () => setModelRequest((n) => n + 1),
    },
    ...(busy
      ? [
          {
            kind: "command" as const,
            name: "stop",
            description: "Stop the reply in progress",
            run: () => void stop(),
          },
        ]
      : []),
    ...(!handedOffBy && mentionables.length
      ? [
          {
            kind: "command" as const,
            name: "handoff",
            description: "Give this task to another bot",
            run: () => {
              update("@");
              requestAnimationFrame(() => {
                input.current?.focus();
                input.current?.setSelectionRange(1, 1);
                mentions.track();
              });
            },
          },
        ]
      : []),
  ];
  const slash = useSlashMenu({
    draft,
    commands,
    skills: skills
      .filter((skill) => skill.enabled && !skill.problem)
      .map((skill) => ({
        kind: "skill" as const,
        name: skill.name,
        description: skill.description,
      })),
    input,
    update,
    onManageSkills: onManageSkills
      ? () => {
          update("");
          onManageSkills();
        }
      : undefined,
  });
  const menuProps = slash.open ? slash.inputProps : mentions.inputProps;
  const track = () => {
    mentions.track();
    slash.track();
  };

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
      draftMode,
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
        conversationId ? undefined : draftMode,
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
      {handedOffBy && <HandoffNote from={handedOffBy} />}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {slash.menu ?? mentions.menu}
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
            aria-label={`${conversationId ? "Reply to" : "Message"} ${botName}`}
            placeholder={`${conversationId ? "Reply to" : "Message"} ${botName}…`}
            value={draft}
            maxLength={4000}
            {...menuProps}
            onSelect={() => {
              revealCaret();
              track();
            }}
            onKeyUp={(event) => {
              revealCaret();
              // Arrow keys move through an open menu, not the caret.
              if (!menuProps["aria-expanded"]) track();
              else if (!/^Arrow(Up|Down)$/.test(event.key)) track();
            }}
            onPointerUp={() => {
              revealCaret();
              track();
            }}
            onChange={(event) => {
              update(event.target.value);
              track();
            }}
            onKeyDown={(event) => {
              if (slash.onKeyDown(event)) return;
              if (mentions.onKeyDown(event)) return;
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
            openRequest={modelRequest}
          />
          {
            <McpPermissions
              key={`${workspace.botId}:${conversationId}`}
              sessionId={conversationId}
              draftMode={draftMode}
              onDraftMode={(mode) => setPermission({ key, mode })}
              askOnly={
                handedOffBy
                  ? `Not in a task from ${handedOffBy.name}: each command needs your approval.`
                  : undefined
              }
            />
          }
          <HandoffDelegates sessionId={conversationId} handoffs={handoffs} />
          <span className="composer-toolbar-spacer" />
          <ComposerPlugins
            enabled={enabledPlugins}
            context={{ draft, model: activeModel?.modelId ?? null, usage }}
          />
          <ContextRing
            used={conversationId ? contextUsed : undefined}
            window={contextWindow}
            usage={usage}
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

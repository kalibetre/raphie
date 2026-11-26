import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type { Provider } from "@earendil-works/pi-ai/models";
import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { JsonObject } from "@earendil-works/pi-durable";

/** Deterministic provider behind the real Pi generation loop, with no network. */
export function chatModel(
  options: {
    fail?: boolean;
    images?: boolean;
    userMessages?: (messages: UserMessage[]) => void;
    started?: () => void;
    requestedModel?: (id: string) => void;
    /** The instructions in effect, as JSON of their sections. */
    systemPrompt?: (text: string) => void;
    /** Every system message in the context, as sent, as JSON. */
    systemMessages?: (text: string) => void;
    offeredTools?: (names: string[]) => void;
    pause?: Promise<void>;
    /** Holds only requests whose newest message contains `text`. */
    pauseOn?: { text: string; until: Promise<void> };
    streamChunkPause?: Promise<void>;
    tool?: { name: string; args: JsonObject };
    repeatTool?: boolean;
    /**
     * The tool each owner message calls, chosen from its text; undefined
     * answers without one. Every message gets its own call.
     */
    toolFor?: (text: string) => { name: string; args: JsonObject } | undefined;
    /**
     * A model with this window that reports realistic usage (about four
     * characters a token) and replies only to the newest message, so a long
     * conversation reaches the summary thresholds.
     */
    contextWindow?: number;
    /** Raphie's own summary of earlier messages: what the summarizer reads. */
    notes?: (transcript: string) => void;
    /** Raphie's own summary fails, so Pi writes one instead. */
    failNotes?: boolean;
  } = {},
) {
  const models = createModels();
  const model = {
    ...openrouterProvider().getModels()[0],
    id: "history",
    provider: "fixture",
    ...(options.contextWindow ? { contextWindow: options.contextWindow } : {}),
    input: options.images
      ? (["text", "image"] as ("text" | "image")[])
      : (["text"] as ("text" | "image")[]),
  };
  const reply: Provider["streamSimple"] = (_model, context, streamOptions) => {
    options.userMessages?.(context.messages.filter((m) => m.role === "user"));
    options.requestedModel?.(_model.id);
    options.offeredTools?.(
      context.messages.flatMap((message) =>
        message.role === "system"
          ? (message.toolsAdded ?? []).map((tool) => tool.name)
          : [],
      ),
    );
    options.systemMessages?.(
      JSON.stringify(context.messages.filter((m) => m.role === "system")),
    );
    // The instructions in effect: later system messages patch earlier
    // sections by key, as Pi replays them, so a continuing chat reports what
    // it follows now rather than everything it was ever told.
    const sections = new Map<string, unknown>();
    for (const message of context.messages)
      if (message.role === "system")
        for (const [key, value] of Object.entries(message.sections ?? {}))
          if (value === null) sections.delete(key);
          else sections.set(key, value);
    options.systemPrompt?.(JSON.stringify(Object.fromEntries(sections)));
    const stream = createAssistantMessageEventStream();
    const texts = context.messages
      .filter((m) => m.role === "user")
      .map((m) =>
        withoutContext(
          typeof m.content === "string"
            ? m.content
            : m.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join(""),
        ),
      );
    const summarizing = context.messages.some(
      (m) =>
        m.role === "system" &&
        JSON.stringify(m.content).includes("context summarization assistant"),
    );
    const noting = context.messages.some(
      (m) =>
        m.role === "system" &&
        JSON.stringify(m.content).includes("You keep the working notes"),
    );
    if (noting) options.notes?.(texts.join("\n"));
    const answer = noting
      ? "## Commitments\n- Fixture notes of the earlier messages."
      : !options.contextWindow
        ? texts.join(" | ")
        : summarizing
          ? "Fixture summary of the earlier messages."
          : `Noted: ${texts.at(-1)?.slice(0, 40) ?? ""}`;
    const input = options.contextWindow
      ? Math.ceil(JSON.stringify(context.messages).length / 4)
      : 1;
    const output = options.contextWindow ? Math.ceil(answer.length / 4) : 1;
    const message: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: answer }],
      api: model.api,
      provider: "fixture",
      model: _model.id,
      stopReason:
        options.fail || (noting && options.failNotes) ? "error" : "stop",
      timestamp: Date.now(),
      usage: {
        input,
        output,
        totalTokens: input + output,
        cacheRead: 0,
        cacheWrite: 0,
        cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 },
      },
    };
    const latestUser =
      options.repeatTool || options.toolFor
        ? context.messages.findLastIndex((m) => m.role === "user")
        : -1;
    const result = context.messages
      .slice(latestUser + 1)
      .findLast((m) => m.role === "toolResult");
    const tool = options.toolFor
      ? options.toolFor(texts.at(-1) ?? "")
      : options.tool;
    if (tool && !result) {
      message.content = [
        {
          type: "toolCall",
          id: "fixture-call",
          name: tool.name,
          arguments: tool.args,
        },
      ];
      message.stopReason = "toolUse";
    } else if (tool && result?.role === "toolResult") {
      message.content = [
        {
          type: "text",
          text: result.content
            .flatMap((p) => (p.type === "text" ? [p.text] : []))
            .join("\n"),
        },
      ];
    }
    options.started?.();
    void (async () => {
      if (options.streamChunkPause) {
        const partial = structuredClone(message);
        partial.content = [{ type: "text", text: "First" }];
        stream.push({ type: "start", partial: structuredClone(partial) });
        await new Promise((resolve) => setTimeout(resolve, 20));
        partial.content = [{ type: "text", text: "First second" }];
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta: " second",
          partial: structuredClone(partial),
        });
        await Promise.race([
          options.streamChunkPause,
          new Promise<void>((done) =>
            streamOptions?.signal?.addEventListener("abort", () => done(), {
              once: true,
            }),
          ),
        ]);
        message.content = [{ type: "text", text: "First second third" }];
      }
      const held =
        options.pause ??
        (options.pauseOn && (texts.at(-1) ?? "").includes(options.pauseOn.text)
          ? options.pauseOn.until
          : undefined);
      if (held)
        await Promise.race([
          held,
          new Promise<void>((done) =>
            streamOptions?.signal?.addEventListener("abort", () => done(), {
              once: true,
            }),
          ),
        ]);
      if (streamOptions?.signal?.aborted) {
        message.stopReason = "aborted";
        stream.push({ type: "error", reason: "aborted", error: message });
      } else if (options.fail)
        stream.push({
          type: "error",
          reason: "error",
          error: { ...message, errorMessage: "Fixture failure" },
        });
      else
        stream.push({
          type: "done",
          reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
          message,
        });
    })();
    return stream;
  };
  models.setProvider({
    id: "fixture",
    name: "Fixture",
    getModels: () => [model],
    auth: {
      apiKey: {
        name: "Fixture",
        resolve: async () => ({ auth: { apiKey: "fixture" } }),
      },
    },
    stream: (m, c, o) => reply(m, c, { signal: o?.signal }),
    streamSimple: reply,
  });
  return { models, model: { provider: "fixture", modelId: "history" } };
}

/** A message's text after the runtime's leading `[Sent …]` and `[Origin …]` lines. */
export function withoutContext(text: string) {
  // The bracketed lines up to the first blank line, and the open work
  // listed among them.
  return text.replace(/^\[[^\n]*\]\n(?:[^\n]+\n)*\n/, "");
}

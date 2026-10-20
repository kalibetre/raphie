import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Provider } from "@earendil-works/pi-ai/models";
import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { JsonObject } from "@earendil-works/pi-durable";

/** Deterministic provider behind the real Pi generation loop, with no network. */
export function chatModel(
  options: {
    fail?: boolean;
    started?: () => void;
    pause?: Promise<void>;
    streamChunkPause?: Promise<void>;
    tool?: { name: string; args: JsonObject };
  } = {},
) {
  const models = createModels();
  const model = {
    ...openrouterProvider().getModels()[0],
    id: "history",
    provider: "fixture",
  };
  const reply: Provider["streamSimple"] = (_model, context, streamOptions) => {
    const stream = createAssistantMessageEventStream();
    const answer = context.messages
      .filter((m) => m.role === "user")
      .map((m) =>
        typeof m.content === "string"
          ? m.content
          : m.content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join(""),
      )
      .join(" | ");
    const message: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: answer }],
      api: model.api,
      provider: "fixture",
      model: "history",
      stopReason: options.fail ? "error" : "stop",
      timestamp: Date.now(),
      usage: {
        input: 1,
        output: 1,
        totalTokens: 2,
        cacheRead: 0,
        cacheWrite: 0,
        cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 },
      },
    };
    const result = context.messages.findLast((m) => m.role === "toolResult");
    if (options.tool && !result) {
      message.content = [
        {
          type: "toolCall",
          id: "fixture-call",
          name: options.tool.name,
          arguments: options.tool.args,
        },
      ];
      message.stopReason = "toolUse";
    } else if (options.tool && result?.role === "toolResult") {
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
      if (options.pause)
        await Promise.race([
          options.pause,
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

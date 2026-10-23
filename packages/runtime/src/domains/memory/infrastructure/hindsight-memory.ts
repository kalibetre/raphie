import { z } from "zod";

import { InputError } from "../../../shared/application/input-error.ts";
import type { MemoryBackend, RetainMemory } from "../application/ports.ts";

const fact = z.object({
  id: z.string(),
  text: z.string(),
  document_id: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
});

/** Uses Hindsight's synchronous API; never redirects a credential to another host. */
export class HindsightMemory implements MemoryBackend {
  private endpoint: string;
  private key: string | null;
  private bank: string;

  constructor(endpoint: string, bank: string, key: string | null) {
    this.endpoint = endpoint;
    this.bank = `/v1/default/banks/${encodeURIComponent(bank)}`;
    this.key = key;
  }

  private async request(path: string, method = "GET", body?: unknown) {
    try {
      const response = await fetch(`${this.endpoint}${this.bank}${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
        headers: {
          "Content-Type": "application/json",
          ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 256 * 1024) throw new Error();
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
    } catch {
      throw new InputError(
        "Hindsight request failed or its outcome is unknown. Check the server before retrying a write.",
        503,
      );
    }
  }

  private tag(scope: string) {
    return `raphie:${scope}`;
  }

  async retain(scope: string, input: RetainMemory) {
    const result = await this.request("/memories", "POST", {
      async: false,
      items: [
        {
          content: input.content,
          timestamp: new Date(input.eventTime).toISOString(),
          document_id: `${scope}:${input.id}`,
          tags: [this.tag(scope)],
          metadata: {
            source: input.source,
            kind: input.kind,
            eventTime: String(input.eventTime),
          },
        },
      ],
    });
    if (
      !z
        .object({ success: z.literal(true), async: z.literal(false) })
        .safeParse(result).success
    )
      throw new InputError(
        "Hindsight did not confirm synchronous retention.",
        503,
      );
  }

  async recall(scope: string, query: string) {
    const result = z.object({ results: z.array(fact).max(100) }).safeParse(
      await this.request("/memories/recall", "POST", {
        query,
        budget: "low",
        max_tokens: 2048,
        types: ["world", "experience"],
        tags: [this.tag(scope)],
        tags_match: "all_strict",
      }),
    );
    if (!result.success)
      throw new InputError(
        "Hindsight returned an unsupported recall response.",
        503,
      );
    return {
      evidence: result.data.results.slice(0, 8).map((item) => ({
        id: item.document_id ?? item.id,
        content: item.text.slice(0, 8000),
        kind:
          item.metadata?.kind === "experience"
            ? ("experience" as const)
            : ("fact" as const),
        source: item.metadata?.source ?? `hindsight:${item.id}`,
        eventTime: Number(item.metadata?.eventTime) || 0,
        revision: 1,
      })),
    };
  }

  async revise(_scope: string, _id: string, _content: string): Promise<void> {
    throw new InputError(
      "Hindsight source corrections are not supported in this slice. Manage sources in Hindsight.",
    );
  }

  async forget(_scope: string, _id: string): Promise<void> {
    throw new InputError(
      "Hindsight source deletion is not supported in this slice. Manage sources in Hindsight.",
    );
  }

  async reflect(scope: string, query: string) {
    const result = z
      .object({
        text: z.string().max(32_000),
        based_on: z
          .object({ memories: z.array(fact).max(100) })
          .nullable()
          .optional(),
      })
      .safeParse(
        await this.request("/reflect", "POST", {
          query,
          budget: "low",
          max_tokens: 1024,
          include: { facts: {} },
          tags: [this.tag(scope)],
          tags_match: "all_strict",
        }),
      );
    if (!result.success)
      throw new InputError(
        "Hindsight returned an unsupported reflection response.",
        503,
      );
    return {
      answer: result.data.text,
      mode: "provider" as const,
      evidence: (result.data.based_on?.memories ?? [])
        .slice(0, 8)
        .map((item) => ({
          // Same ID recall returns, so citations match across both.
          id: item.document_id ?? item.id,
          content: item.text.slice(0, 8000),
          kind: "fact" as const,
          source: `hindsight:${item.id}`,
          eventTime: 0,
          revision: 1,
        })),
    };
  }

  async test() {
    await this.request("");
  }
}

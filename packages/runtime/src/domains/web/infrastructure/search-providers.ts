import type { Api, Model } from "@earendil-works/pi-ai";

import {
  uniqueSources,
  type WebSearchAnswer,
  type WebSource,
} from "../domain/search.ts";

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export type SearchAuth = {
  apiKey?: string;
  headers?: Record<string, string | null>;
  baseUrl?: string;
};

const SEARCH_TIMEOUT_MS = 90_000;

const SYSTEM = [
  "You answer one web search request for another assistant.",
  "Search the web, then reply with the facts that answer the request: names, numbers, dates and quotes where they matter.",
  "Say plainly when sources disagree or when you found nothing reliable. Keep it under 600 words and cite sources as markdown links.",
].join(" ");

/**
 * Which way a model's connection can search the web, if any: OpenRouter's
 * web plugin, or OpenAI's Responses web search (an API key or a ChatGPT
 * sign-in, which reaches the same API).
 */
export function webSearchRoute(model: Model<Api>, baseUrl?: string) {
  let host: string;
  try {
    host = new URL(baseUrl ?? model.baseUrl ?? "").hostname;
  } catch {
    return undefined;
  }
  if (host === "openrouter.ai") return "openrouter" as const;
  if (host === "api.openai.com") return "openai" as const;
  return undefined;
}

function headers(auth: SearchAuth, extra: Record<string, string>) {
  return {
    ...extra,
    // A null header value means "send no such header".
    ...Object.fromEntries(
      Object.entries(auth.headers ?? {}).filter(
        (entry): entry is [string, string] => entry[1] !== null,
      ),
    ),
    ...(auth.apiKey ? { authorization: `Bearer ${auth.apiKey}` } : {}),
  };
}

async function failure(response: Response, provider: string) {
  return new Error(
    `The ${provider} search request failed with HTTP ${response.status}. ${(await response.text()).slice(0, 300)}`,
  );
}

/**
 * OpenRouter's web plugin: the model's own provider searches where it can
 * (OpenAI, Anthropic, Google and others), and Exa for the rest. Citations
 * come back as url_citation annotations.
 */
export async function openRouterSearch(
  fetcher: Fetch,
  model: Model<Api>,
  auth: SearchAuth,
  prompt: string,
): Promise<WebSearchAnswer> {
  // OpenRouter's Anthropic-format models carry ".../api" (their client adds
  // "/v1/messages"), the rest ".../api/v1". Chat completions serves both.
  const base = (auth.baseUrl ?? model.baseUrl)
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "");
  const response = await fetcher(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: headers(auth, { "content-type": "application/json" }),
    body: JSON.stringify({
      model: model.id,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      plugins: [{ id: "web", max_results: 5 }],
      max_tokens: 1500,
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) throw await failure(response, "OpenRouter");
  const body = (await response.json()) as {
    choices?: {
      message?: {
        content?: string | null;
        annotations?: {
          type?: string;
          url_citation?: { url?: string; title?: string };
        }[];
      };
    }[];
  };
  const message = body.choices?.[0]?.message;
  const sources: WebSource[] = (message?.annotations ?? []).flatMap((note) =>
    note.type === "url_citation" && note.url_citation?.url
      ? [
          {
            url: note.url_citation.url,
            title: note.url_citation.title || note.url_citation.url,
          },
        ]
      : [],
  );
  return { answer: message?.content ?? "", sources: uniqueSources(sources) };
}

type ResponsesEvent = {
  type?: string;
  delta?: string;
  message?: string;
  error?: { message?: string };
  annotation?: Annotation;
  item?: OutputItem;
  response?: { output?: OutputItem[]; error?: { message?: string } };
};

type Annotation = { type?: string; url?: string; title?: string };

type OutputItem = {
  type?: string;
  action?: { sources?: { url?: string; title?: string }[] };
  content?: { type?: string; annotations?: Annotation[] }[];
};

/** Each "data:" payload of a server-sent event stream, parsed as JSON. */
async function* events(response: Response): AsyncGenerator<ResponsesEvent> {
  if (!response.body) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data) as ResponsesEvent;
      } catch {
        // A keep-alive or partial line carries no event.
      }
    }
  }
}

/**
 * OpenAI's Responses API with its web_search tool. A ChatGPT sign-in reaches
 * this same API with its access token, and rejects output-limit fields, so
 * none are sent. Streaming is the one mode both accept.
 *
 * The request shape follows pi-web-search (ttttmr/pi-web-search, MIT).
 */
export async function openAIResponsesSearch(
  fetcher: Fetch,
  model: Model<Api>,
  auth: SearchAuth,
  prompt: string,
): Promise<WebSearchAnswer> {
  const base = (auth.baseUrl ?? model.baseUrl).replace(/\/+$/, "");
  const response = await fetcher(`${base}/responses`, {
    method: "POST",
    headers: headers(auth, {
      "content-type": "application/json",
      accept: "text/event-stream",
    }),
    body: JSON.stringify({
      model: model.id,
      instructions: SYSTEM,
      input: [
        { role: "user", content: [{ type: "input_text", text: prompt }] },
      ],
      tools: [{ type: "web_search" }],
      include: ["web_search_call.action.sources"],
      stream: true,
      store: false,
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) throw await failure(response, "OpenAI");
  let answer = "";
  const cited: WebSource[] = [];
  const searched: WebSource[] = [];
  const cite = (note?: Annotation) => {
    if (note?.type === "url_citation" && note.url)
      cited.push({ url: note.url, title: note.title || note.url });
  };
  const collect = (item?: OutputItem) => {
    for (const source of item?.action?.sources ?? [])
      if (source.url)
        searched.push({ url: source.url, title: source.title || source.url });
    for (const part of item?.content ?? [])
      for (const note of part.annotations ?? []) cite(note);
  };
  for await (const event of events(response)) {
    if (event.type === "error" || event.type === "response.failed")
      throw new Error(
        `The OpenAI search failed. ${event.message ?? event.error?.message ?? event.response?.error?.message ?? ""}`.trim(),
      );
    if (event.type === "response.output_text.delta")
      answer += event.delta ?? "";
    else if (event.type === "response.output_text.annotation.added")
      cite(event.annotation);
    else if (event.type === "response.output_item.done") collect(event.item);
    else if (
      event.type === "response.completed" ||
      event.type === "response.incomplete"
    )
      for (const item of event.response?.output ?? []) collect(item);
  }
  // Cited sources first; the pages the search read when nothing was cited.
  return {
    answer,
    sources: uniqueSources(cited.length ? cited : searched),
  };
}

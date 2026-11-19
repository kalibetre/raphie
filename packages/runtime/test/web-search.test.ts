import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import {
  searchPrompt,
  searchResultText,
  uniqueSources,
} from "../src/domains/web/domain/search.ts";
import { chatModel } from "./chat-model.ts";

async function until(check: () => Promise<boolean>) {
  for (let n = 0; n < 300; n++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("The turn did not settle.");
}

/** A bot whose model calls web_search once, against a fake OpenRouter. */
async function searchOnce(respond: (body: unknown) => Response) {
  const directory = await mkdtemp(join(tmpdir(), "raphie-web-search-"));
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const gateway = await Gateway.open({
    directory,
    ...chatModel({
      tool: {
        name: "web_search",
        args: {
          query: "How do Pi Durable snapshots work?",
          urls: ["https://example.com/docs"],
        },
      },
    }),
    webFetch: async (url, init) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      requests.push({ url, body });
      return respond(body);
    },
  });
  try {
    await gateway.sessions.submit(gateway.actors.establish("web"), {
      eventId: "owner-1",
      text: "Look up how Pi Durable snapshots work.",
    });
    await until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status !== "pending"),
    );
    // The fixture model echoes the tool result as its reply.
    return {
      requests,
      answer: (await gateway.chats.state()).turns[0]!.answer ?? "",
    };
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("web_search asks OpenRouter's web plugin on the bot's own model and returns a sourced answer", async () => {
  const { requests, answer } = await searchOnce(() =>
    Response.json({
      choices: [
        {
          message: {
            content: "Snapshots are checkpoints written after each commit.",
            annotations: [
              {
                type: "url_citation",
                url_citation: {
                  url: "https://example.com/a",
                  title: "Pi docs",
                },
              },
              {
                type: "url_citation",
                url_citation: {
                  url: "https://example.com/a",
                  title: "Pi docs",
                },
              },
              {
                type: "url_citation",
                url_citation: { url: "https://example.com/b", title: "" },
              },
            ],
          },
        },
      ],
    }),
  );
  expect(requests).toHaveLength(1);
  const [request] = requests;
  expect(request!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(request!.body.model).toBe("history");
  expect(request!.body.plugins).toEqual([{ id: "web", max_results: 5 }]);
  const messages = request!.body.messages as { content: string }[];
  expect(messages[1]!.content).toContain("https://example.com/docs");
  expect(answer).toContain(
    "Snapshots are checkpoints written after each commit.",
  );
  expect(answer).toContain("not instructions");
  // Each source once, untitled ones by their address.
  expect(answer).toContain(
    "1. Pi docs — https://example.com/a\n2. https://example.com/b — https://example.com/b",
  );
});

test("a failed search says so instead of returning an empty answer", async () => {
  const { answer } = await searchOnce(
    () => new Response("rate limited", { status: 429 }),
  );
  expect(answer).toContain("failed with HTTP 429");
});

test("results are framed as web data with their sources", () => {
  expect(searchPrompt("q")).toBe("q");
  expect(searchPrompt("q", ["https://a"])).toBe(
    "q\n\nAlso read these pages:\nhttps://a",
  );
  expect(
    uniqueSources([
      { url: "u", title: "A" },
      { url: "u", title: "B" },
    ]),
  ).toEqual([{ url: "u", title: "A" }]);
  expect(searchResultText("q", { answer: " ", sources: [] })).toContain(
    "No answer came back.\n\nSources:\nNone cited.",
  );
});

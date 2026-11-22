import { expect, test } from "bun:test";

import {
  stepsSummary,
  toolPhrase,
} from "../src/domains/conversations/application/tool-phrases";

test("built-in tools say what the bot did", () => {
  expect(toolPhrase({ tool: "schedule_update" })).toBe(
    "Updated a scheduled job",
  );
  expect(toolPhrase({ tool: "memory_retain" })).toBe(
    "Noted something to remember",
  );
});

test("a connected tool names its service, or the tool when there is none", () => {
  expect(toolPhrase({ tool: "execute", server: "Executor" })).toBe(
    "Used Executor",
  );
  expect(toolPhrase({ tool: "mystery" })).toBe("Used mystery");
});

test("a summary says each thing once and counts past the second", () => {
  expect(
    stepsSummary([{ tool: "memory_retain" }, { tool: "memory_retain" }]),
  ).toBe("Noted something to remember");
  expect(
    stepsSummary([
      { tool: "schedule_update" },
      { tool: "memory_retain" },
      { tool: "web_search" },
      { tool: "read_document" },
    ]),
  ).toBe("Updated a scheduled job, noted something to remember and 2 more");
});

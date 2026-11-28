import { expect, test } from "bun:test";

import {
  isPlumbing,
  stepsSummary,
  toolDoing,
  toolPhrase,
  toolWords,
} from "../src/domains/conversations/application/tool-phrases";

test("built-in tools say what the bot did, and what it is doing", () => {
  expect(toolPhrase({ tool: "schedule_update" })).toBe(
    "Updated a scheduled job",
  );
  expect(toolPhrase({ tool: "memory_retain" })).toBe(
    "Noted something to remember",
  );
  expect(toolDoing({ tool: "web_search" })).toBe("Searching the web");
});

test("a connected tool says what it did in the service the owner named", () => {
  const list = { tool: "t3_thread_list", connection: "id" };
  expect(toolPhrase(list, "T3 Code")).toBe("Checked T3 Code");
  expect(toolDoing(list, "T3 Code")).toBe("Checking T3 Code");
  expect(toolPhrase({ tool: "search", connection: "id" }, "Executor")).toBe(
    "Searched Executor",
  );
  expect(toolPhrase({ tool: "create_draft", server: "gmail" })).toBe(
    "Added to Gmail",
  );
  expect(toolPhrase({ tool: "execute", server: "executor" })).toBe(
    "Used Executor",
  );
  expect(toolPhrase({ tool: "mystery" })).toBe("Used mystery");
});

test("a connected tool's own name reads as words, without a length hash", () => {
  expect(toolWords({ tool: "t3_thread_list" })).toBe("t3 thread list");
  expect(toolWords({ tool: "list_scheduled_tasks_a1b2c3d4" })).toBe(
    "list scheduled tasks",
  );
});

test("finding tools and showing cards are how the bot works, not what it did", () => {
  expect(isPlumbing({ tool: "tool_search" })).toBe(true);
  expect(isPlumbing({ tool: "show_card" })).toBe(true);
  expect(isPlumbing({ tool: "show_card", server: "x" })).toBe(false);
  expect(isPlumbing({ tool: "web_search" })).toBe(false);
});

test("a summary says each thing once and counts past the second", () => {
  expect(
    stepsSummary([{ tool: "memory_retain" }, { tool: "memory_retain" }]),
  ).toBe("Noted something to remember");
  expect(
    stepsSummary([{ tool: "web_search" }, { tool: "memory_retain" }]),
  ).toBe("Searched the web and noted something to remember");
  expect(
    stepsSummary([
      { tool: "schedule_update" },
      { tool: "memory_retain" },
      { tool: "web_search" },
      { tool: "read_document" },
    ]),
  ).toBe("Updated a scheduled job, noted something to remember and 2 more");
});

test("a summary names each service as the owner did", () => {
  const names: Record<string, string> = { a: "T3 Code" };
  expect(
    stepsSummary(
      [
        { tool: "t3_thread_list", connection: "a" },
        { tool: "t3_thread_read", connection: "a" },
      ],
      (s) => names[s.connection ?? ""],
    ),
  ).toBe("Checked T3 Code");
});

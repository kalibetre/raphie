import { expect, test } from "bun:test";

import { splitMarkdown } from "../src/infrastructure/chat-sdk/split-markdown.ts";

test("short replies stay whole, and nothing is sent for no text", () => {
  expect(splitMarkdown("Hello", 100)).toEqual(["Hello"]);
  expect(splitMarkdown("", 100)).toEqual([]);
});

test("replies split at a line break, within the size", () => {
  const text = ["a".repeat(40), "b".repeat(40), "c".repeat(40)].join("\n");
  const parts = splitMarkdown(text, 90);
  expect(parts).toEqual([
    `${"a".repeat(40)}\n${"b".repeat(40)}`,
    "c".repeat(40),
  ]);
  for (const part of parts) expect(part.length).toBeLessThanOrEqual(90);
});

test("a code block cut across chunks is closed and reopened with its language", () => {
  const code = Array.from({ length: 12 }, (_, i) => `line ${i} of the code`);
  const text = ["Here it is:", "```ts", ...code, "```", "Done."].join("\n");
  const parts = splitMarkdown(text, 120);
  expect(parts.length).toBeGreaterThan(1);
  for (const part of parts) {
    expect(part.length).toBeLessThanOrEqual(120);
    // Every chunk opens and closes as many fences as it needs on its own.
    const fences = part.split("\n").filter((l) => l.startsWith("```"));
    expect(fences.length % 2).toBe(0);
  }
  expect(parts[1]!.startsWith("```ts\n")).toBe(true);
  expect(parts.at(-1)!.endsWith("```\nDone.")).toBe(true);
  // Nothing is lost: drop the added fences and the code reads straight through.
  const rejoined = parts
    .join("\n")
    .split("\n")
    .filter((l) => !l.startsWith("```"));
  expect(rejoined).toEqual(["Here it is:", ...code, "Done."]);
});

test("a line longer than a chunk is cut at a space, never in a surrogate pair", () => {
  const words = Array.from({ length: 30 }, () => "word").join(" ");
  for (const part of splitMarkdown(words, 50)) {
    expect(part.length).toBeLessThanOrEqual(50);
    expect(part.endsWith("wor")).toBe(false);
  }
  const emoji = "😀".repeat(40);
  const parts = splitMarkdown(emoji, 25);
  expect(parts.join("")).toBe(emoji);
  for (const part of parts) expect(part).not.toMatch(/[\uD800-\uDBFF]$/);
});

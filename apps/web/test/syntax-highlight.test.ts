import { expect, test } from "bun:test";

import { highlightCode } from "../src/shared/syntax/highlight";

test("highlights a known language with both themes as CSS variables", async () => {
  const html = await highlightCode("const answer = 42;", "ts");
  expect(html).toContain('class="shiki');
  expect(html).toContain("--shiki-light");
  expect(html).toContain("--shiki-dark");
  expect(html).toContain("answer");
});

test("resolves language aliases such as js and sh", async () => {
  expect(await highlightCode("console.log(1)", "js")).toContain("--shiki-dark");
  expect(await highlightCode("echo hello", "sh")).toContain("--shiki-dark");
});

test("escapes markup in code so it cannot inject HTML", async () => {
  const html = await highlightCode('<img src=x onerror="alert(1)">', "html");
  expect(html).not.toContain("<img");
  expect(html).toContain("&#x3C;");
});

test("returns null for unknown languages so the plain block is shown", async () => {
  expect(await highlightCode("whatever", "not-a-language")).toBeNull();
  expect(await highlightCode("whatever", "")).toBeNull();
});

test("skips highlighting for very large blocks", async () => {
  expect(await highlightCode("x".repeat(200_000), "ts")).toBeNull();
});

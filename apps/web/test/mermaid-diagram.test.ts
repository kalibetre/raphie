import { expect, test } from "bun:test";

import { renderAsync } from "pele/lazy";
import { createElement } from "react";

import { mermaidSource } from "../src/domains/conversations/presentation/mermaid-diagram";

test("mermaidSource returns the source of a fenced mermaid block", () => {
  const block = createElement(
    "code",
    { className: "language-mermaid" },
    "flowchart LR\n  A --> B\n",
  );
  expect(mermaidSource(block)).toBe("flowchart LR\n  A --> B");
});

test("mermaidSource ignores other fenced languages and plain text", () => {
  expect(
    mermaidSource(
      createElement("code", { className: "language-ts" }, "const a = 1"),
    ),
  ).toBeNull();
  expect(mermaidSource("just text")).toBeNull();
  expect(mermaidSource(null)).toBeNull();
});

test("pele renders a valid flowchart to SVG", async () => {
  const { svg } = await renderAsync("flowchart LR\n  A[Start] --> B[Done]");
  expect(svg).toContain("<svg");
  expect(svg).toContain("Start");
});

test("pele escapes HTML in diagram labels", async () => {
  const { svg } = await renderAsync(
    'flowchart LR\n  A["<img src=x onerror=alert(1)>"] --> B[Done]',
  );
  expect(svg).not.toContain("onerror");
  expect(svg).not.toContain("<img");
});

test("pele rejects text that is not a diagram, so the UI can fall back to code", async () => {
  let rejected = false;
  try {
    await renderAsync("not a diagram");
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
});

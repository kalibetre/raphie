import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ReplyActions } from "../src/domains/conversations/presentation/reply-actions";

test("a finished reply offers Copy and Reply, with when it was said", () => {
  const html = renderToStaticMarkup(
    <ReplyActions
      text="Hello"
      at={Date.UTC(2026, 10, 27, 15, 30)}
      time="3:30 PM"
      title="120 tokens across 1 model call"
      onReply={() => undefined}
    />,
  );
  expect(html).toContain('aria-label="Copy"');
  expect(html).toContain('aria-label="Reply"');
  expect(html).toContain(">3:30 PM</time>");
  expect(html).toContain('title="120 tokens across 1 model call"');
});

test("without a way to quote, there is no Reply", () => {
  const html = renderToStaticMarkup(<ReplyActions text="Hello" />);
  expect(html).toContain('aria-label="Copy"');
  expect(html).not.toContain("Reply");
  expect(html).not.toContain("<time");
});

test("a reply with no words still says when it was said", () => {
  const html = renderToStaticMarkup(
    <ReplyActions
      text={"\n"}
      at={Date.UTC(2026, 10, 27, 15, 30)}
      time="3:30 PM"
      onReply={() => undefined}
    />,
  );
  expect(html).toContain(">3:30 PM</time>");
  expect(html).not.toContain("Copy");
  expect(html).not.toContain("Reply");
});

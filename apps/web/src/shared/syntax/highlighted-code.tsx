import { isValidElement, type ReactNode, useEffect, useState } from "react";

import { CodeBlock } from "../ui/code-block";
import { ScrollArea } from "../ui/scroll-area";
import { highlightCode } from "./highlight";

/** Language and text of a fenced block, read from its <code> child. */
export function fencedCode(
  children: ReactNode,
): { language: string; code: string } | null {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children))
    return null;
  const { className, children: code } = children.props;
  const language = className
    ?.split(" ")
    .find((name) => name.startsWith("language-"))
    ?.slice("language-".length);
  if (!language || typeof code !== "string") return null;
  return { language, code: code.replace(/\n$/, "") };
}

/**
 * A fenced code block with syntax colors. The plain block shows until the
 * highlighter is ready, and it stays as the fallback for unknown languages.
 * While a reply streams, the last highlighted version stays on screen until
 * the newer one is ready.
 */
export function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    highlightCode(code, language).then(
      (result) => {
        if (current) setHtml(result);
      },
      () => {
        if (current) setHtml(null);
      },
    );
    return () => {
      current = false;
    };
  }, [code, language]);
  if (html === null)
    return (
      <CodeBlock>
        <code className={`language-${language}`}>{code}</code>
      </CodeBlock>
    );
  return (
    <ScrollArea
      className="code-highlight"
      orientation="both"
      viewportLabel="Code and details"
    >
      {/* Shiki escapes the code text, so the markup carries no raw HTML. */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </ScrollArea>
  );
}

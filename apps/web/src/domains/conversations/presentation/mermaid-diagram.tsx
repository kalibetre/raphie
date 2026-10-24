import { renderAsync } from "pele/lazy";
import { isValidElement, type ReactNode, useEffect, useState } from "react";

import { CodeBlock } from "../../../shared/ui/code-block";

type Rendered = { svg: string } | { failed: true } | null;

/** The Mermaid source of a fenced ```mermaid block, or null for any other block. */
export function mermaidSource(children: ReactNode): string | null {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children))
    return null;
  const { className, children: code } = children.props;
  if (!className?.split(" ").includes("language-mermaid")) return null;
  return typeof code === "string" ? code.replace(/\n$/, "") : null;
}

/**
 * Renders a Mermaid diagram from a bot reply. Pele loads each diagram type on
 * demand. While a reply streams, the last good diagram stays on screen; if the
 * source never becomes valid, the source is shown as a plain code block.
 */
export function MermaidDiagram({ source }: { source: string }) {
  const [rendered, setRendered] = useState<Rendered>(null);
  useEffect(() => {
    let current = true;
    renderAsync(source).then(
      ({ svg }) => {
        if (current) setRendered({ svg });
      },
      () => {
        if (current) setRendered({ failed: true });
      },
    );
    return () => {
      current = false;
    };
  }, [source]);
  if (rendered && "failed" in rendered)
    return (
      <CodeBlock>
        <code className="language-mermaid">{source}</code>
      </CodeBlock>
    );
  if (!rendered)
    return (
      <div
        className="mermaid-diagram mermaid-pending"
        role="status"
        aria-label="Rendering diagram"
      />
    );
  return (
    <div
      className="mermaid-diagram"
      role="img"
      aria-label="Diagram"
      // Pele escapes label text, so labels cannot inject markup.
      dangerouslySetInnerHTML={{ __html: rendered.svg }}
    />
  );
}

import type { Components } from "react-markdown";

import {
  fencedCode,
  HighlightedCode,
} from "../../../shared/syntax/highlighted-code";
import { CodeBlock } from "../../../shared/ui/code-block";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { MermaidDiagram, mermaidSource } from "./mermaid-diagram";

export const markdownComponents: Components = {
  pre: ({ children }) => {
    const source = mermaidSource(children);
    if (source !== null) return <MermaidDiagram source={source} />;
    const fence = fencedCode(children);
    return fence ? (
      <HighlightedCode code={fence.code} language={fence.language} />
    ) : (
      <CodeBlock>{children}</CodeBlock>
    );
  },
  table: ({ children }) => (
    <ScrollArea orientation="horizontal" viewportLabel="Message table">
      <table>{children}</table>
    </ScrollArea>
  ),
};

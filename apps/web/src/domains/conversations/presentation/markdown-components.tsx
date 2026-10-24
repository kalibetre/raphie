import type { Components } from "react-markdown";

import { CodeBlock } from "../../../shared/ui/code-block";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { MermaidDiagram, mermaidSource } from "./mermaid-diagram";

export const markdownComponents: Components = {
  pre: ({ children }) => {
    const source = mermaidSource(children);
    return source === null ? (
      <CodeBlock>{children}</CodeBlock>
    ) : (
      <MermaidDiagram source={source} />
    );
  },
  table: ({ children }) => (
    <ScrollArea orientation="horizontal" viewportLabel="Message table">
      <table>{children}</table>
    </ScrollArea>
  ),
};

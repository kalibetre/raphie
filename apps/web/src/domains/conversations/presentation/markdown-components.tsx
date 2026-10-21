import type { Components } from "react-markdown";

import { CodeBlock } from "../../../shared/ui/code-block";
import { ScrollArea } from "../../../shared/ui/scroll-area";

export const markdownComponents: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => (
    <ScrollArea orientation="horizontal" viewportLabel="Message table">
      <table>{children}</table>
    </ScrollArea>
  ),
};

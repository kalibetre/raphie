import type { ComponentProps } from "react";

import { ScrollArea } from "./scroll-area";

export function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
  return (
    <ScrollArea
      className="code-scroll"
      orientation="both"
      viewportLabel="Code and details"
    >
      <pre {...props}>{children}</pre>
    </ScrollArea>
  );
}

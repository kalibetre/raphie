// Composed from the shadcn AI Elements chat pattern. The scrolling primitive
// preserves the reader's position while new text arrives.
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import type { ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "../ui/button";
export function Conversation({ children }: { children: ReactNode }) {
  return (
    <StickToBottom className="conversation" resize="smooth" initial="instant">
      <StickToBottom.Content className="conversation-content">
        {children}
      </StickToBottom.Content>
      <ScrollButton />
    </StickToBottom>
  );
}
function ScrollButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return (
    !isAtBottom && (
      <Button
        className="scroll-bottom"
        size="icon"
        variant="outline"
        aria-label="Scroll to latest message"
        onClick={() => void scrollToBottom()}
      >
        <ArrowDown />
      </Button>
    )
  );
}

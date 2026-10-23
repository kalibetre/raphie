import { ArrowDown } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

import { Button } from "../../../shared/ui/button";
import { ScrollArea } from "../../../shared/ui/scroll-area";

export function Conversation({
  children,
  onRead,
}: {
  children: ReactNode;
  onRead?: () => void;
}) {
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
    useStickToBottom({ resize: "smooth", initial: "instant" });
  useEffect(() => {
    const read = () => {
      if (isAtBottom && document.visibilityState === "visible") onRead?.();
    };
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, [isAtBottom, onRead]);
  return (
    <div className="conversation">
      <ScrollArea
        className="conversation-scroll"
        viewportRef={scrollRef}
        viewportLabel="Conversation messages"
      >
        <div ref={contentRef} className="conversation-content">
          {children}
        </div>
      </ScrollArea>
      {!isAtBottom && (
        <Button
          className="scroll-bottom rounded-full"
          size="icon"
          variant="outline"
          aria-label="Scroll to latest message"
          onClick={() => void scrollToBottom()}
        >
          <ArrowDown />
        </Button>
      )}
    </div>
  );
}

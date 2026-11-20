import type { TurnCompaction } from "@raphie/contracts";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../shared/ui/collapsible";
import { markdownComponents } from "./markdown-components";

const why: Record<TurnCompaction["reason"], string> = {
  threshold: "The conversation was getting long for the model.",
  overflow: "The model's context was full.",
  manual: "You asked for it.",
};

/**
 * Where the bot stopped reading earlier messages word for word: from here on
 * it reads a summary of them. The messages above stay in the transcript.
 */
export function CompactionDivider({
  compaction,
}: {
  compaction: TurnCompaction;
}) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="compaction-divider"
    >
      <div className="compaction-divider-rule">
        <CollapsibleTrigger className="compaction-divider-trigger">
          <span>Earlier messages summarized</span>
          <span className="compaction-divider-action">
            {open ? "Hide summary" : "View summary"}
            <Chevron size={13} aria-hidden="true" />
          </span>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="compaction-summary">
        <p className="compaction-summary-why">
          {why[compaction.reason]} The bot now reads this summary instead of the
          messages above; they stay here for you.
        </p>
        <div className="markdown">
          <ReactMarkdown
            components={markdownComponents}
            remarkPlugins={[remarkGfm]}
          >
            {compaction.summary}
          </ReactMarkdown>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

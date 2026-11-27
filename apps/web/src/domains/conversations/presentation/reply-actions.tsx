import { Check, Copy, Reply } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "../../../shared/ui/button";

/**
 * Under a finished reply, shown while it is pointed at: copy its text, reply
 * to it (the next message quotes it), and when it was said, with what it
 * cost on hover.
 */
export function ReplyActions({
  text,
  at,
  time,
  title,
  onReply,
}: {
  text: string;
  at?: number;
  /** `at` as the conversation shows times. */
  time?: string;
  /** What the reply cost, for the curious. */
  title?: string;
  onReply?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="reply-actions">
      <Button
        variant="ghost"
        size="icon-xs"
        className="reply-action"
        aria-label={copied ? "Copied" : "Copy"}
        title={copied ? "Copied" : "Copy"}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(text)
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      {onReply && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="reply-action"
          aria-label="Reply"
          title="Reply"
          onClick={onReply}
        >
          <Reply aria-hidden="true" />
        </Button>
      )}
      {at && time && (
        <time
          className="reply-time"
          dateTime={new Date(at).toISOString()}
          title={title}
        >
          {time}
        </time>
      )}
    </div>
  );
}

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
  /** The reply's words; with none, only the time shows. */
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
      {text.trim() && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="reply-action"
          aria-label={copied ? "Copied" : "Copy"}
          title={copied ? "Copied" : "Copy"}
          onClick={() => {
            void copyText(text).then(setCopied);
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      )}
      {onReply && text.trim() && (
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

/**
 * Puts `text` on the clipboard. Over plain HTTP away from localhost the
 * browser has no clipboard API, so it falls back to the older copy command.
 * Resolves whether it worked.
 */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    // oxlint-disable-next-line typescript/no-deprecated -- the only copy without the clipboard API
    const done = document.execCommand("copy");
    field.remove();
    return done;
  }
}

import { ArrowUp, Square } from "lucide-react";

import { Button } from "../../../shared/ui/button";

export function ComposerActions({
  busy,
  hasContent,
  sending,
  uploading,
  disabled,
  onStop,
}: {
  busy: boolean;
  hasContent: boolean;
  sending: boolean;
  uploading: boolean;
  disabled: boolean;
  onStop: () => void;
}) {
  const stopOnly = busy && !hasContent;
  return (
    <>
      {busy && hasContent && (
        <details className="composer-task-menu">
          <summary aria-label="Task actions">⋯</summary>
          <button type="button" disabled={sending} onClick={onStop}>
            Stop task
          </button>
        </details>
      )}
      <Button
        variant={stopOnly ? "ghost" : "default"}
        className={`ml-auto size-8 rounded-full transition-[transform,opacity,background-color] duration-150 enabled:hover:scale-105 enabled:active:scale-95 ${stopOnly ? "bg-destructive/15 text-destructive hover:bg-destructive/25" : ""}`}
        type={stopOnly ? "button" : "submit"}
        onClick={stopOnly ? onStop : undefined}
        size="icon"
        aria-label={stopOnly ? "Stop task" : "Send message"}
        disabled={
          disabled ||
          sending ||
          (uploading && hasContent) ||
          (!busy && !hasContent)
        }
      >
        {stopOnly ? <Square /> : <ArrowUp />}
      </Button>
    </>
  );
}

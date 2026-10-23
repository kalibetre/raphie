import type { ReactNode } from "react";

import { Button } from "../../../shared/ui/button";

/**
 * Floating save controls, styled like the composer. It appears only when
 * there is something to save or report, so clean pages stay quiet.
 */
export function SaveBar({
  visible,
  status,
  error,
  pending,
  canSave,
  canDiscard,
  label = "Save changes",
  onDiscard,
  extra,
}: {
  visible: boolean;
  status: string;
  error?: string;
  pending: boolean;
  canSave: boolean;
  canDiscard: boolean;
  label?: string;
  onDiscard: () => void;
  /** Secondary action, such as testing a saved connection. */
  extra?: ReactNode;
}) {
  return (
    <div className="save-bar" data-visible={visible}>
      <div className="save-bar-copy">
        {error && (
          <p role="alert" className="settings-error">
            {error}
          </p>
        )}
        <p role="status">{status}</p>
      </div>
      {extra}
      <Button
        type="button"
        variant="ghost"
        disabled={pending || !canDiscard}
        onClick={onDiscard}
      >
        Discard
      </Button>
      <Button type="submit" disabled={pending || !canSave}>
        {pending ? "Saving…" : label}
      </Button>
    </div>
  );
}

import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

/** Preserve an editor until the owner saves or explicitly discards its draft. */
export function useSettingsGuard(dirty: boolean, busy = false) {
  const bypass = useRef(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!dirty && !busy) setMessage("");
  }, [dirty, busy]);
  useBlocker({
    shouldBlockFn: () => {
      if (bypass.current || (!dirty && !busy)) return false;
      setMessage(
        busy
          ? "Wait for this change to finish before leaving."
          : "Save or discard your changes before leaving this page.",
      );
      return true;
    },
    enableBeforeUnload: dirty || busy,
  });
  return {
    message,
    allowNavigation: () => {
      bypass.current = true;
    },
  };
}

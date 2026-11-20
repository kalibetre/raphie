import { useCallback } from "react";

import { useBackend } from "../../../../infrastructure/http/backend-context";
import { readLocal } from "../../../../infrastructure/preferences/storage";

/** Where this browser keeps the session last open with a bot on a Raphie. */
export const lastSessionKey = (url: string, botId: string) =>
  `raphie:last-session:${encodeURIComponent(url)}:${botId}`;

/** The session last open with a bot here, if any. */
export function useLastSession() {
  const { workspace } = useBackend();
  return useCallback(
    (botId: string) => readLocal(lastSessionKey(workspace.url, botId)),
    [workspace.url],
  );
}

import { History } from "lucide-react";

import { Button } from "../../../../shared/ui/button";

/** In place of the composer, in a session kept from before chats. */
export function HistoryNotice({ onChat }: { onChat: () => void }) {
  return (
    <div className="composer-wrap">
      <div className="history-notice" role="note">
        <History className="history-notice-icon" size={16} aria-hidden />
        <p className="history-notice-text">
          This conversation is from before chats. It’s kept as history.
        </p>
        <Button size="sm" onClick={onChat}>
          Go to the chat
        </Button>
      </div>
    </div>
  );
}

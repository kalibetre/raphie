import { ArrowLeft, Bell, ChevronsLeft, ChevronsRight } from "lucide-react";

import { BotAvatar } from "../../domains/settings/presentation/bot-avatar";
import { Button } from "../../shared/ui/button";

export function WorkspaceHeader({
  title,
  breadcrumb,
  botId,
  description,
  collapsed,
  onToggleNavigation,
  onBack,
  onList,
  onBotSettings,
  onNotifications,
  notificationCount,
}: {
  /** A session other than the chat; the chat is named by its bot alone. */
  title: string | undefined;
  breadcrumb: string;
  botId: string;
  description: string;
  collapsed: boolean;
  onToggleNavigation: () => void;
  onBack?: () => void;
  /** On a phone: back to your team. */
  onList?: () => void;
  onBotSettings: () => void;
  onNotifications: () => void;
  notificationCount: number;
}) {
  return (
    <header className="workspace-header bot-workspace-header">
      <div className="header-identity">
        {onList && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to your team"
            title="Back to your team"
            onClick={onList}
          >
            <ArrowLeft size={16} />
          </Button>
        )}
        <Button
          className="navigation-toggle hidden md:inline-flex"
          variant="ghost"
          size="icon-sm"
          aria-label={collapsed ? "Show sidebar (⌘B)" : "Hide sidebar (⌘B)"}
          aria-pressed={!collapsed}
          onClick={onToggleNavigation}
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </Button>
        <BotAvatar id={botId} />
        <button
          className="header-bot"
          onClick={onBotSettings}
          aria-label={`Settings for ${breadcrumb}`}
          title={description || undefined}
        >
          <strong>{breadcrumb}</strong>
        </button>
      </div>
      <h1 className={title ? "header-conversation-title" : "sr-only"}>
        {title ?? `Chat with ${breadcrumb}`}
      </h1>
      <div className="header-actions">
        {onBack && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to the chat"
            title="Back to the chat"
            onClick={onBack}
          >
            <ArrowLeft size={16} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Notifications${notificationCount ? `, ${notificationCount} updates` : ""}`}
          title="Notifications"
          onClick={onNotifications}
        >
          <Bell size={17} />
          {notificationCount > 0 && (
            <span className="notification-badge">
              {notificationCount > 99 ? "99+" : notificationCount}
            </span>
          )}
        </Button>
      </div>
    </header>
  );
}

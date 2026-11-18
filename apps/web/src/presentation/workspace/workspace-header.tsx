import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bell,
  ChevronsLeft,
  ChevronsRight,
  SquarePen,
} from "lucide-react";

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
  onNew,
  archived,
  onArchive,
  onBotSettings,
  onNotifications,
  notificationCount,
}: {
  title: string | undefined;
  breadcrumb: string;
  botId: string;
  description: string;
  collapsed: boolean;
  onToggleNavigation: () => void;
  onBack?: () => void;
  /** On a phone: back to the bot's conversation list. */
  onList?: () => void;
  onNew?: () => void;
  /** Whether the open conversation is archived. */
  archived?: boolean;
  /** Archives the open conversation, or brings it back. */
  onArchive?: () => void;
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
            aria-label="Back to conversations"
            title="Back to conversations"
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
      <h1 className="header-conversation-title">
        {title}
        {archived && <span className="header-archived">Archived</span>}
      </h1>
      <div className="header-actions">
        {onBack && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to conversations"
            title="Back to conversations"
            onClick={onBack}
          >
            <ArrowLeft size={16} />
          </Button>
        )}
        {onArchive && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              archived ? "Unarchive conversation" : "Archive conversation"
            }
            title={archived ? "Unarchive" : "Archive"}
            onClick={onArchive}
          >
            {archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}
          </Button>
        )}
        {onNew && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New conversation"
            title="New conversation"
            onClick={onNew}
          >
            <SquarePen size={17} />
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

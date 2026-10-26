import {
  ArrowLeft,
  Bell,
  ChevronsLeft,
  ChevronsRight,
  PanelRight,
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
  inspector,
  showInspector,
  onToggleNavigation,
  onToggleInspector,
  onBack,
  onNew,
  unreadCount,
  onBotSettings,
  onNotifications,
  notificationCount,
}: {
  title: string | undefined;
  breadcrumb: string;
  botId: string;
  description: string;
  collapsed: boolean;
  inspector: boolean;
  showInspector: boolean;
  onOpenNavigation: () => void;
  onToggleNavigation: () => void;
  onToggleInspector: () => void;
  onBack?: () => void;
  onNew?: () => void;
  unreadCount: number;
  onBotSettings: () => void;
  onNotifications: () => void;
  notificationCount: number;
}) {
  return (
    <header className="workspace-header bot-workspace-header">
      <div className="header-identity">
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
        >
          <strong>{breadcrumb}</strong>
          <small>{description}</small>
        </button>
      </div>
      <h1 className="header-conversation-title">{title}</h1>
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
        {showInspector && (
          <Button
            className="panel-toggle"
            variant="ghost"
            size="icon-sm"
            aria-label={`${inspector ? "Hide" : "Show"} conversations panel${unreadCount ? `, ${unreadCount} need attention` : ""}`}
            title="Conversations"
            aria-pressed={inspector}
            onClick={onToggleInspector}
          >
            <PanelRight size={16} />
            {unreadCount > 0 && (
              <span className="reply-count">{unreadCount}</span>
            )}
          </Button>
        )}
      </div>
    </header>
  );
}

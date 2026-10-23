import {
  ArrowLeft,
  ListFilter,
  PanelLeft,
  PanelRight,
  Settings,
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
  onLibrary,
  library,
  unreadCount,
  onBotSettings,
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
  onLibrary?: () => void;
  library?: boolean;
  unreadCount: number;
  onBotSettings: () => void;
}) {
  return (
    <header className="workspace-header bot-workspace-header">
      <div className="header-identity">
        <Button
          className="hidden md:inline-flex"
          variant="ghost"
          size="icon-sm"
          aria-label={collapsed ? "Show sidebar (⌘B)" : "Hide sidebar (⌘B)"}
          aria-pressed={!collapsed}
          onClick={onToggleNavigation}
        >
          <PanelLeft size={16} />
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
      <h1 className="header-conversation-title">
        {library ? "Conversations" : title}
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
        {onLibrary && (
          <Button
            className="library-button"
            variant={library ? "secondary" : "outline"}
            size="sm"
            aria-label={`Conversations${unreadCount ? `, ${unreadCount} need attention` : ""}`}
            aria-pressed={library}
            onClick={onLibrary}
          >
            <ListFilter size={14} />
            <span>Conversations</span>
            {unreadCount > 0 && (
              <span className="reply-count">{unreadCount}</span>
            )}
          </Button>
        )}
        {!onLibrary && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Bot settings"
            onClick={onBotSettings}
          >
            <Settings size={16} />
          </Button>
        )}
        {showInspector && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle activity inspector"
            aria-pressed={inspector}
            onClick={onToggleInspector}
          >
            <PanelRight size={16} />
          </Button>
        )}
      </div>
    </header>
  );
}

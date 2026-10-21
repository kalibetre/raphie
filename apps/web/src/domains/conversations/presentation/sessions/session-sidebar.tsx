import {
  Activity as ActivityIcon,
  Moon,
  Search,
  Settings,
  SquarePen,
  Sun,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import type { Snapshot } from "../../../../infrastructure/http/api-client";
import { Button } from "../../../../shared/ui/button";
import { ScrollArea } from "../../../../shared/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../../shared/ui/tooltip";
import { isDark, toggleTheme } from "../../../settings/infrastructure/theme";
import { getSessionSummaries } from "../../application/session-summaries";
import { SessionCard } from "./session-card";

type View = "diagnostics" | "settings";

export function SessionSidebar({
  data,
  conversationId,
  view,
  sidebar,
  setSidebar,
  connected,
  select,
  hasMore,
  loadMore,
}: {
  data?: Snapshot;
  hasMore?: boolean;
  loadMore: () => void;
  conversationId?: string;
  view?: View;
  sidebar: boolean;
  setSidebar: (open: boolean) => void;
  connected: boolean;
  select: (id?: string, view?: View) => void;
}) {
  const [filter, setFilter] = useState("");
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(isDark()), []);
  const now = Date.now();
  const conversations = getSessionSummaries(data, filter, now);
  const issues = data?.uncertainToolDeliveries.length ?? 0;
  return (
    <aside
      className={`sidebar ${sidebar ? "sidebar-open" : ""}`}
      aria-label="Main navigation"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setSidebar(false);
          document
            .querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')
            ?.focus();
        }
        if (sidebar && event.key === "Tab") {
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>("button, input"),
          ).filter((el) => el.offsetParent !== null);
          const first = items[0],
            last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div className="sidebar-top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            r
          </span>
          raphie
        </div>
        <IconButton label="New conversation" onClick={() => select()}>
          <SquarePen />
        </IconButton>
        <Button
          className="md:hidden"
          variant="ghost"
          size="icon-sm"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        >
          <X />
        </Button>
      </div>
      <label className="search-field">
        <Search size={14} />
        <input
          aria-label="Search conversations"
          placeholder="Search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </label>
      <ScrollArea className="session-scroll" viewportLabel="Saved sessions">
        <nav className="conversation-list" aria-label="Conversations">
          {conversations.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              selected={session.id === conversationId && !view}
              now={now}
              onSelect={() => select(session.id)}
            />
          ))}
          {hasMore && <button onClick={loadMore}>Load more sessions</button>}
          {data && !conversations.length && (
            <p className="sidebar-empty">
              {filter ? "No matches." : "Your conversations will live here."}
            </p>
          )}
        </nav>
      </ScrollArea>
      <div className="sidebar-bottom">
        <span
          className="runtime-status"
          role="status"
          title={
            data?.mcp.connected
              ? `MCP: ${data.mcp.server ?? "connected"} · ${data.mcp.toolCount} tools`
              : "No MCP server connected"
          }
        >
          <span className={`status-dot ${connected ? "" : "offline"}`} />
          {connected ? "Connected" : "Reconnecting…"}
        </span>
        <IconButton
          label="Diagnostics"
          pressed={view === "diagnostics"}
          badge={issues || undefined}
          onClick={() => select(conversationId, "diagnostics")}
        >
          <ActivityIcon />
        </IconButton>
        <IconButton
          label={dark ? "Light mode" : "Dark mode"}
          onClick={() => setDark(toggleTheme())}
        >
          {dark ? <Sun /> : <Moon />}
        </IconButton>
        <IconButton
          label="Settings"
          onClick={() => select(conversationId, "settings")}
        >
          <Settings />
        </IconButton>
      </div>
    </aside>
  );
}

function IconButton({
  label,
  pressed,
  badge,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  badge?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className="icon-button"
          variant="ghost"
          size="icon-sm"
          aria-label={badge ? `${label} (${badge} need attention)` : label}
          aria-pressed={pressed}
          onClick={onClick}
        >
          {children}
          {badge && <span className="icon-badge">{badge}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

import { useState } from "react";
import {
  Activity as ActivityIcon,
  MessageSquare,
  Plus,
  Puzzle,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import type { Snapshot } from "../lib/api";
export function WorkspaceSidebar({
  data,
  conversationId,
  view,
  sidebar,
  setSidebar,
  connected,
  select,
}: {
  data?: Snapshot;
  conversationId?: number;
  view?: "diagnostics" | "plugins";
  sidebar: boolean;
  setSidebar: (open: boolean) => void;
  connected: boolean;
  select: (id?: number, view?: "diagnostics" | "plugins") => void;
}) {
  const [filter, setFilter] = useState("");
  const pending =
    data?.toolApprovals.filter((p) => p.status === "pending").length ?? 0;
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
      <div className="brand">
        <span className="brand-mark">r</span>
        <span>
          raphie<span className="brand-caption">PERSONAL WORKSPACE</span>
        </span>
        <Button
          className="mobile-close"
          variant="ghost"
          size="icon"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        >
          <X />
        </Button>
      </div>
      <Button
        className="new-conversation"
        variant="outline"
        onClick={() => select()}
      >
        <Plus size={16} /> New conversation
      </Button>
      <nav className="primary-nav">
        <button
          className={!view ? "active" : ""}
          onClick={() => select(conversationId)}
        >
          <MessageSquare /> Conversations{" "}
          <span>{data?.conversations.length ?? 0}</span>
        </button>
        <button
          className={view === "diagnostics" ? "active" : ""}
          onClick={() => select(conversationId, "diagnostics")}
        >
          <ActivityIcon /> Diagnostics{pending > 0 && <span>{pending}</span>}
        </button>
        <button
          className={view === "plugins" ? "active" : ""}
          onClick={() => select(conversationId, "plugins")}
        >
          <Puzzle /> Plugins
        </button>
      </nav>
      <div className="conversation-label">CONVERSATIONS</div>
      <label className="search-field sidebar-search">
        <Search size={14} />
        <input
          aria-label="Search conversations"
          placeholder="Find a conversation"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </label>
      <div className="conversation-list">
        {data?.conversations
          .toReversed()
          .filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()))
          .map((c) => (
            <button
              key={c.id}
              className={c.id === conversationId && !view ? "selected" : ""}
              onClick={() => select(c.id)}
            >
              <MessageSquare size={14} />
              <span>{c.title}</span>
              {c.discordThreadId && (
                <span
                  className="channel-indicator"
                  title="Connected to Discord"
                >
                  D
                </span>
              )}
            </button>
          ))}
        {data && !data.conversations.length && (
          <p className="sidebar-empty">Your conversations will live here.</p>
        )}
      </div>
      <div className="sidebar-bottom">
        <div className="runtime-status">
          <span className={`status-dot ${connected ? "" : "offline"}`} />
          <span>
            {connected ? "Runtime connected" : "Reconnecting to runtime"}
          </span>
        </div>
        <div className="profile">
          <span className="profile-avatar">K</span>
          <div>
            <strong>Your workspace</strong>
            <span>Personal · Local</span>
          </div>
          <ShieldCheck size={16} />
        </div>
      </div>
    </aside>
  );
}

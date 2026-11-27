import { type DockView, openDock } from "./dock";

/**
 * How the owner arranged the dock in each conversation, for as long as the
 * page is open. It lives outside any component, so moving between pages
 * keeps it; a reload starts afresh.
 */
let views: Readonly<Record<string, DockView>> = {};
const listeners = new Set<() => void>();

export const dockViews = {
  get: () => views,
  of: (conversationId: string) => views[conversationId] ?? openDock,
  set: (conversationId: string, change: (view: DockView) => DockView) => {
    const current = views[conversationId] ?? openDock;
    const next = change(current);
    if (next === current) return;
    views = { ...views, [conversationId]: next };
    for (const listener of listeners) listener();
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

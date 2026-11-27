import type {
  ClientWorkspace,
  SessionApproval,
  SessionAsk,
} from "@raphie/contracts";

/** One thing waiting on the owner, as the dock on the composer shows it. */
export type DockItem = {
  id: string;
  kind: "question" | "approval";
  /** Who asks: the work item, or the bot itself in its own conversation. */
  title: string;
  /** The work item it belongs to, for background work. */
  itemId?: string;
  createdAt: number;
  ask?: SessionAsk;
  approval?: SessionApproval;
};

const live = (approval: SessionApproval, now: number) =>
  approval.status === "pending" && approval.expiresAt > now;

/**
 * Every question and approval waiting on the owner in this conversation:
 * its own, and, in the bot's chat, those of its background work. Oldest
 * first, so the dock asks in the order they were asked.
 */
export function dockItems(
  state: Pick<ClientWorkspace, "asks" | "toolApprovals" | "background">,
  conversationId: string,
  botName: string,
  now = Date.now(),
): DockItem[] {
  const items: DockItem[] = [
    ...state.asks
      .filter((a) => a.conversationId === conversationId)
      .filter((a) => a.status === "pending")
      .map((ask) => ({
        id: ask.id,
        kind: "question" as const,
        title: botName,
        createdAt: ask.createdAt,
        ask,
      })),
    ...state.toolApprovals
      .filter((a) => a.conversationId === conversationId && live(a, now))
      .map((approval) => ({
        id: approval.id,
        kind: "approval" as const,
        title: botName,
        createdAt: approval.createdAt,
        approval,
      })),
    ...(state.background ?? []).flatMap((request) => [
      ...request.asks
        .filter((a) => a.status === "pending")
        .map((ask) => ({
          id: ask.id,
          kind: "question" as const,
          title: request.title,
          itemId: request.itemId,
          createdAt: ask.createdAt,
          ask,
        })),
      ...request.toolApprovals
        .filter((a) => live(a, now))
        .map((approval) => ({
          id: approval.id,
          kind: "approval" as const,
          title: request.title,
          itemId: request.itemId,
          createdAt: approval.createdAt,
          approval,
        })),
    ]),
  ];
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * How the owner has arranged the dock in one conversation: the items they
 * skipped, in the order they skipped them, and, while it is folded away,
 * what it held when they folded it.
 */
export type DockView = {
  skipped: readonly string[];
  foldedWith?: readonly string[];
};

export const openDock: DockView = { skipped: [] };

/**
 * The dock as the owner sees it: skipped items wait at the back, in the order
 * they were skipped. It stays folded until something new arrives, so a new
 * question is never hidden behind a bar.
 */
export function arrangeDock(items: readonly DockItem[], view: DockView) {
  const rank = (item: DockItem) => view.skipped.indexOf(item.id);
  const fresh = items.filter((item) => rank(item) < 0);
  const skipped = items
    .filter((item) => rank(item) >= 0)
    .sort((a, b) => rank(a) - rank(b));
  const folded =
    !!view.foldedWith &&
    items.length > 0 &&
    items.every((item) => view.foldedWith!.includes(item.id));
  return { items: [...fresh, ...skipped], folded };
}

/** Sends the top item to the back of the dock. */
export function skipTop(
  view: DockView,
  arranged: readonly DockItem[],
): DockView {
  const top = arranged[0];
  if (!top || arranged.length < 2) return view;
  const live = new Set(arranged.map((item) => item.id));
  return {
    ...view,
    skipped: [
      ...view.skipped.filter((id) => id !== top.id && live.has(id)),
      top.id,
    ],
  };
}

/** Folds the dock to a bar until something new arrives. */
export const foldDock = (
  view: DockView,
  items: readonly DockItem[],
): DockView => ({
  ...view,
  foldedWith: items.map((item) => item.id),
});

export const unfoldDock = (view: DockView): DockView => ({
  skipped: view.skipped,
});

/**
 * Once something new arrives at a folded dock, the dock opens for good with
 * the new item on top: what it held when folded waits behind it, as if
 * skipped. Returns the settled view, or `undefined` when nothing changes.
 */
export function settleDock(
  view: DockView,
  items: readonly DockItem[],
): DockView | undefined {
  const held = view.foldedWith;
  if (!held || arrangeDock(items, view).folded) return undefined;
  const behind = arrangeDock(items, view)
    .items.filter((item) => held.includes(item.id))
    .map((item) => item.id);
  return { skipped: behind };
}

/** The dock's top item in one line, for the folded bar. */
export function dockLine(item: DockItem) {
  if (item.ask) return item.ask.question;
  if (item.approval) {
    const { tool, server } = item.approval;
    return `Run ${tool}${server ? ` on ${server}` : ""}?`;
  }
  return "";
}

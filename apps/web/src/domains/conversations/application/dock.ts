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

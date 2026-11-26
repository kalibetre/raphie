import type { Context } from "@earendil-works/chord/context";
import type { Conversation, Harness } from "@earendil-works/pi-durable";

import { ToolApprovals } from "../../approvals/infrastructure/pi-tool-approvals.ts";
import { Asks } from "../../asks/infrastructure/pi-asks.ts";
import { ChannelBindings } from "../../channels/infrastructure/pi-bindings.ts";
import { Handoffs } from "../../handoffs/infrastructure/bot-handoffs.ts";
import { JobRuns } from "../../schedules/infrastructure/job-runs.ts";
import { historyToRemove } from "../domain/chat.ts";
import { Chats } from "./pi-conversation-service.ts";

/**
 * Removes every session the owner can no longer write in, with what refers
 * to it, so a bot keeps its one chat. `backup` runs first, and only when
 * there is something to remove; nothing is removed unless it succeeds.
 *
 * The model's own record of a removed session stays in the bot's storage,
 * which has no way to delete one; nothing reaches it any more.
 */
export async function removeHistory(
  { root, harness }: { root: Conversation; harness: Harness },
  backup: () => Promise<void>,
  context: Context,
) {
  const plan = async () => {
    const chats = await harness.snapshot(Chats, context);
    if (!chats) return [];
    const bindings =
      (await harness.snapshot(ChannelBindings, context))?.bindings ?? [];
    // A handoff still working reports back to the session it came from.
    const busy = new Set(
      ((await harness.snapshot(Handoffs, context))?.items ?? [])
        .filter((handoff) => handoff.status === "working")
        .map((handoff) => handoff.fromSessionId),
    );
    return historyToRemove(chats.conversations, chats.turns, bindings, busy);
  };
  const planned = await plan();
  if (!planned.length) return 0;
  await backup();
  const sessions = new Set(planned.map((c) => c.sessionId));
  return root.commit(async (tx) => {
    const chats = await tx.doc(Chats);
    const bindings = await tx.doc(ChannelBindings);
    // Only what was backed up, and only if it is still history.
    const removed = historyToRemove(
      chats.conversations,
      chats.turns,
      bindings.bindings,
    ).filter((c) => sessions.has(c.sessionId));
    const ids = new Set(removed.map((c) => c.id));
    const gone = new Set(removed.map((c) => c.sessionId));
    const turns = new Set(
      chats.turns.filter((t) => ids.has(t.conversationId)).map((t) => t.id),
    );
    chats.conversations = chats.conversations.filter((c) => !ids.has(c.id));
    chats.turns = chats.turns.filter((t) => !turns.has(t.id));
    chats.deliveries = chats.deliveries.filter((d) => !turns.has(d.turnId));
    bindings.bindings = bindings.bindings.filter((b) => !gone.has(b.sessionId));

    const approvals = await tx.doc(ToolApprovals);
    const approvalIds = new Set(
      approvals.approvals
        .filter((a) => ids.has(a.conversationId))
        .map((a) => a.id),
    );
    approvals.approvals = approvals.approvals.filter(
      (a) => !approvalIds.has(a.id),
    );
    approvals.deliveries = approvals.deliveries.filter(
      (d) => !approvalIds.has(d.approvalId),
    );
    if (approvals.grants)
      approvals.grants = approvals.grants.filter(
        (g) => !ids.has(g.conversationId),
      );
    for (const modes of [approvals.commandModes, approvals.modes])
      for (const id of ids)
        if (modes) Reflect.deleteProperty(modes, String(id));

    const asks = await tx.doc(Asks);
    const askIds = new Set(
      asks.asks.filter((a) => ids.has(a.conversationId)).map((a) => a.id),
    );
    asks.asks = asks.asks.filter((a) => !askIds.has(a.id));
    asks.deliveries = asks.deliveries.filter((d) => !askIds.has(d.askId));

    for (const run of (await tx.doc(JobRuns)).items)
      if (run.sessionId && gone.has(run.sessionId)) {
        run.sessionId = null;
        run.turnId = null;
      }
    const handoffs = await tx.doc(Handoffs);
    handoffs.items = handoffs.items.filter((h) => !gone.has(h.fromSessionId));
    return removed.length;
  }, context);
}

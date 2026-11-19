import { useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Switch } from "../../../shared/ui/switch";
import { useHandoffs } from "../../conversations/infrastructure/use-handoffs";
import { useBots } from "../infrastructure/use-bots";
import { BotAvatar } from "./bot-avatar";
import { Group, Row } from "./settings-group";
import { SettingsStatus } from "./settings-status";

/** Which other bots this bot may hand tasks to. Off for every bot until chosen. */
export function HandoffSettings() {
  const { workspace } = useBackend();
  const bots = useBots();
  const handoffs = useHandoffs();
  const [error, setError] = useState("");
  const others = bots.data?.items.filter((bot) => bot.id !== workspace.botId);
  const self = bots.data?.items.find((bot) => bot.id === workspace.botId);
  if (!handoffs.data || !others)
    return (
      <SettingsStatus
        title="Handoffs"
        message={
          handoffs.error || bots.error
            ? "Could not load handoffs."
            : "Loading handoffs…"
        }
        onRetry={
          handoffs.error || bots.error
            ? () => {
                void handoffs.refetch();
                void bots.refetch();
              }
            : undefined
        }
      />
    );
  const allowed = new Set(handoffs.data.targets.map((target) => target.id));
  const name = self?.name ?? "This bot";

  async function toggle(id: string, on: boolean) {
    setError("");
    const next = new Set(allowed);
    if (on) next.add(id);
    else next.delete(id);
    try {
      await handoffs.setTargets.mutateAsync([...next]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save. Please retry.",
      );
    }
  }

  return (
    <>
      <Group
        title="Can hand tasks to"
        note={`${name} writes the brief. The other bot works on it in its own session and sends the result back to the conversation it came from.`}
      >
        {others.length ? (
          others.map((bot) => (
            <Row
              key={bot.id}
              icon={<BotAvatar id={bot.id} color={bot.color ?? undefined} />}
              title={bot.name}
              description={bot.description}
            >
              <Switch
                checked={allowed.has(bot.id)}
                disabled={handoffs.setTargets.isPending}
                aria-label={`Allow ${name} to hand tasks to ${bot.name}`}
                onCheckedChange={(on) => void toggle(bot.id, on)}
              />
            </Row>
          ))
        ) : (
          <Row
            title="No other bots yet"
            description="Create another bot, then choose here whether this one may hand it tasks."
          />
        )}
      </Group>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Group
        title="What a handed-off task may do"
        note="A task from another bot never carries your authority. Its session always asks before running commands or tools, and the approvals come to you. A bot working on a handed-off task cannot hand it on. At most three tasks from one bot to another are open at a time."
      />
    </>
  );
}

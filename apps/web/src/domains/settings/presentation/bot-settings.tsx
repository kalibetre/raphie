import { useBackend } from "../../../infrastructure/http/backend-context";
import { useBots } from "../infrastructure/use-bots";
import { BotForm } from "./bot-profile-form";
import { PersonalityHistory } from "./personality-history";
import { SettingsStatus } from "./settings-status";

type Mode = "profile" | "create" | "history";

export function BotSettings({ mode = "profile" }: { mode?: Mode }) {
  const { workspace, selectBot } = useBackend();
  const bots = useBots();
  const profile = bots.data?.items.find((b) => b.id === workspace.botId);
  if (mode === "create") return <BotForm mode="create" />;
  if (!profile)
    return (
      <SettingsStatus
        title="Bot"
        message={
          bots.error
            ? "Bot settings are unavailable."
            : bots.data
              ? "This bot no longer exists."
              : "Loading bot…"
        }
        onRetry={
          bots.data
            ? () => void selectBot("default")
            : bots.error
              ? () => void bots.refetch()
              : undefined
        }
        action={bots.data ? "Open default bot" : "Retry"}
      />
    );
  if (mode === "history") return <PersonalityHistory profile={profile} />;
  return (
    <BotForm key={`${profile.id}:${mode}`} profile={profile} mode={mode} />
  );
}

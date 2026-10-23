import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { useBots } from "../infrastructure/use-bots";
import { BotForm } from "./bot-profile-form";
import { PersonalityHistory } from "./personality-history";
import { Group } from "./settings-group";

type Mode = "profile" | "personality" | "create" | "history";

export function BotSettings({ mode = "profile" }: { mode?: Mode }) {
  const { workspace, selectBot } = useBackend();
  const bots = useBots();
  const profile = bots.data?.items.find((b) => b.id === workspace.botId);
  if (mode === "create") return <BotForm mode="create" />;
  if (!profile)
    return (
      <Group title="Bot">
        <div className="settings-form">
          <p role="status">
            {bots.error
              ? "Bot settings are unavailable."
              : bots.data
                ? "This bot no longer exists."
                : "Loading bot…"}
          </p>
          <Button
            variant="outline"
            onClick={() =>
              bots.data ? void selectBot("default") : void bots.refetch()
            }
          >
            {bots.data ? "Open default bot" : "Retry"}
          </Button>
        </div>
      </Group>
    );
  if (mode === "history") return <PersonalityHistory profile={profile} />;
  return (
    <BotForm key={`${profile.id}:${mode}`} profile={profile} mode={mode} />
  );
}

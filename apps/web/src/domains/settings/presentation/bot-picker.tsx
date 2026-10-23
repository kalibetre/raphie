import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import { useBots } from "../infrastructure/use-bots";

export function BotPicker() {
  const { workspace, selectBot } = useBackend();
  const bots = useBots();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [switching, setSwitching] = useState(false);
  if (!bots.data)
    return (
      <p className="bot-picker-label">
        {bots.error ? "Bot management unavailable" : "Loading bots…"}
      </p>
    );
  return (
    <div className="bot-picker">
      <span className="bot-picker-label">Current bot</span>
      <Select
        value={workspace.botId}
        disabled={switching}
        onValueChange={(id) => {
          if (!id || id === workspace.botId) return;
          setError("");
          setSwitching(true);
          void selectBot(id).catch((error) => {
            setError(
              error instanceof Error ? error.message : "Could not switch bots.",
            );
            setSwitching(false);
          });
        }}
        items={bots.data.items.map((bot) => ({
          value: bot.id,
          label: bot.id === "default" ? `${bot.name} · default` : bot.name,
        }))}
      >
        <SelectTrigger aria-label="Current bot">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {bots.data.items.map((bot) => (
            <SelectItem key={bot.id} value={bot.id}>
              {bot.name}
              {bot.id === "default" ? " · default" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          void navigate({
            to: "/",
            search: {
              bot: workspace.botId === "default" ? undefined : workspace.botId,
              view: "settings",
              section: "bot",
            },
          })
        }
      >
        Manage bot
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

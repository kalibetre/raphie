import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../shared/ui/button";
import { BotAvatar } from "./bot-avatar";
import { useBotStyle } from "./bot-tones";

/**
 * The top of every settings page. Bot pages carry the bot's avatar and a wash
 * of its colour, so whose settings these are is visible before any field.
 */
export function SettingsPage({
  title,
  lede,
  bot,
  scope = "App-wide",
  back,
  children,
}: {
  title: string;
  lede: string;
  /** The bot these settings belong to; omit for app-wide pages. */
  bot?: { id: string; name: string };
  /** Scope label when there is no bot, e.g. "New bot". */
  scope?: string;
  /** Sub-pages link back to the page they were opened from. */
  back?: { label: string; onClick: () => void };
  children: ReactNode;
}) {
  const botStyle = useBotStyle();
  return (
    <section className="settings-page">
      <header
        className={`settings-hero ${bot ? "" : "settings-hero-app"}`}
        style={bot ? botStyle(bot.id) : undefined}
      >
        <div className="settings-hero-copy">
          {back && (
            <Button
              variant="ghost"
              size="sm"
              className="settings-back"
              onClick={back.onClick}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              {back.label}
            </Button>
          )}
          <h1>{title}</h1>
          <p>{lede}</p>
        </div>
        <span className="settings-scope-tag">
          <BotAvatar id={bot?.id ?? "default"} />
          {bot ? `${bot.name} only` : scope}
        </span>
      </header>
      {children}
    </section>
  );
}

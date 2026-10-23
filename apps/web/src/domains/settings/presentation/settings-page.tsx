import type { ReactNode } from "react";

import { BotAvatar, botTone } from "./bot-avatar";

/**
 * The top of every settings page. Bot pages carry the bot's avatar and a wash
 * of its colour, so whose settings these are is visible before any field.
 */
export function SettingsPage({
  title,
  lede,
  bot,
  scope = "App-wide",
  children,
}: {
  title: string;
  lede: string;
  /** The bot these settings belong to; omit for app-wide pages. */
  bot?: { id: string; name: string };
  /** Scope label when there is no bot, e.g. "New bot". */
  scope?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-page">
      <header
        className={`settings-hero ${bot ? `tone-${botTone(bot.id)}` : "settings-hero-app"}`}
      >
        <div className="settings-hero-copy">
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

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
        <span className="settings-scope-tag">
          {bot ? (
            <BotAvatar id={bot.id} />
          ) : (
            <span className="brand-mark" aria-hidden="true" />
          )}
          {bot ? `${bot.name} only` : scope}
        </span>
        <h1>{title}</h1>
        <p>{lede}</p>
      </header>
      {children}
    </section>
  );
}

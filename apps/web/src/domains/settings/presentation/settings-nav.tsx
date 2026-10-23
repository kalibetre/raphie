import { ArrowLeft } from "lucide-react";

import { Button } from "../../../shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import { BotAvatar } from "./bot-avatar";
import { isAppSection, type Section, sections } from "./settings";

export function SettingsNav({
  section,
  onSelect,
  onBack,
  name,
  botId,
}: {
  section: Section;
  onSelect: (section: Section) => void;
  onBack: () => void;
  name: string;
  botId: string;
}) {
  const app = isAppSection(section);
  const entries = sections.filter(
    (s) =>
      isAppSection(s.id) === app && !["new-bot", "bot-history"].includes(s.id),
  );
  const items = entries.map((s) => ({ value: s.id, label: s.label }));
  if (!items.some((s) => s.value === section))
    items.unshift({
      value: section,
      label: sections.find((s) => s.id === section)!.label,
    });
  return (
    <>
      <nav className="bot-settings-nav" aria-label="Settings sections">
        <div className="settings-nav-identity">
          {!app && <BotAvatar id={botId} />}
          <div>
            <strong>{app ? "App settings" : name}</strong>
            <small>{app ? "Across all bots" : "Bot settings"}</small>
          </div>
        </div>
        <div className="roster-label">{app ? "This app" : "This bot"}</div>
        {entries.map((entry) => (
          <button
            key={entry.id}
            className="settings-nav-item"
            aria-current={
              section === entry.id ||
              (section === "bot-history" && entry.id === "personality")
                ? "page"
                : undefined
            }
            onClick={() => onSelect(entry.id)}
          >
            {entry.label}
          </button>
        ))}
        <p className="settings-nav-note">
          {app
            ? "These preferences apply to the app or this browser."
            : `Changes apply to ${name}. Other bots keep their own configuration.`}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSelect(app ? "bot" : "general")}
        >
          {app ? "Bot settings" : "App settings"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={13} /> Back to conversations
        </Button>
      </nav>
      <div className="mobile-settings-nav">
        <Select
          value={section}
          onValueChange={(value) => {
            if (value) onSelect(value as Section);
          }}
          items={items}
        >
          <SelectTrigger aria-label="Settings page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((entry) => (
              <SelectItem key={entry.value} value={entry.value}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSelect(app ? "bot" : "general")}
        >
          {app ? "Bot settings" : "App settings"}
        </Button>
      </div>
    </>
  );
}

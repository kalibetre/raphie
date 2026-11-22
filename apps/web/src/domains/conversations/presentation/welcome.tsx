import {
  CalendarClock,
  type LucideIcon,
  Mail,
  MessageSquare,
  Search,
} from "lucide-react";
import type { ReactNode } from "react";

/**
 * Work a teammate can take on. Choosing one puts the request in the
 * composer to edit and send; nothing is sent until the owner sends it.
 */
const jobs: {
  icon: LucideIcon;
  title: string;
  detail: string;
  request: string;
}[] = [
  {
    icon: CalendarClock,
    title: "Send me a morning briefing",
    detail: "Your day, every morning",
    request: "Send me a short briefing of my day every morning.",
  },
  {
    icon: Mail,
    title: "Keep an eye on my inbox",
    detail: "Draft replies for my OK",
    request:
      "Keep an eye on my inbox and draft replies for me to check before anything is sent.",
  },
  {
    icon: Search,
    title: "Research something",
    detail: "And write it up",
    request: "Research this for me and write up what you find: ",
  },
  {
    icon: MessageSquare,
    title: "Help me think something through",
    detail: "No setup needed",
    request: "Help me think something through: ",
  },
];

/** A new conversation: the bot's empty desk, and work it can take on. */
export function Welcome({
  disabled,
  onSuggest,
  avatar,
}: {
  disabled: boolean;
  onSuggest: (text: string) => void;
  avatar: ReactNode;
}) {
  return (
    <div className="welcome">
      <div className="welcome-avatar">{avatar}</div>
      <h2>I’m ready when you are.</h2>
      <p>Give me something to look after, or just ask.</p>
      <div className="welcome-jobs" role="group" aria-label="Things to ask">
        {jobs.map(({ icon: Icon, title, detail, request }) => (
          <button
            key={title}
            className="welcome-job"
            disabled={disabled}
            onClick={() => onSuggest(request)}
          >
            <Icon size={16} aria-hidden="true" />
            <span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

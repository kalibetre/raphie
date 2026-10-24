import {
  BookOpen,
  Bot,
  Brain,
  Clock,
  History,
  KeyRound,
  Library,
  Palette,
  Plug,
  Puzzle,
  Radio,
  Server,
  Sparkles,
  UserRound,
} from "lucide-react";

/**
 * Every settings page. Ids are URL values (`?section=`), so they never change.
 * `lede` introduces the page in the voice of the bot it configures.
 */
export const sections = [
  {
    id: "mcp",
    label: "MCP tools",
    icon: Plug,
    lede: (bot: string) =>
      `Connect the tools ${bot} can use. Every connection belongs to this bot.`,
  },
  {
    id: "jobs",
    label: "Scheduled jobs",
    icon: Clock,
    lede: (bot: string) =>
      `Give ${bot} recurring work, with results saved in a conversation.`,
  },
  {
    id: "bot",
    label: "Profile",
    icon: UserRound,
    lede: (bot: string) =>
      `How ${bot} introduces itself in your sidebar and conversations.`,
  },
  {
    id: "personality",
    label: "Personality",
    icon: Sparkles,
    lede: (bot: string) =>
      `The voice and values ${bot} brings to every conversation. Each save becomes a revision.`,
  },
  {
    id: "bot-history",
    label: "Revision history",
    icon: History,
    lede: (bot: string) =>
      `Every saved version of ${bot}’s personality, newest first.`,
  },
  {
    id: "new-bot",
    label: "Create a bot",
    icon: Bot,
    lede: () =>
      "A separate assistant with its own personality, memory and model connections.",
  },
  {
    id: "connection",
    label: "Backend connection",
    icon: Server,
    lede: () =>
      "The Raphie runtime this browser talks to. Each backend has its own bots.",
  },
  {
    id: "providers",
    label: "Providers",
    icon: KeyRound,
    lede: (bot: string) =>
      `Model connections only ${bot} can use. Keys stay encrypted on this machine.`,
  },
  {
    id: "models",
    label: "Models",
    icon: Brain,
    lede: (bot: string) =>
      `Compare what ${bot} can run, and pick where new conversations start.`,
  },
  {
    id: "memory",
    label: "Memory",
    icon: BookOpen,
    lede: (bot: string) =>
      `What ${bot} keeps between conversations, and where it lives.`,
  },
  {
    id: "memory-browse",
    label: "Browse memory",
    icon: Library,
    lede: (bot: string) =>
      `What ${bot} remembers, with sources. Correct or forget anything.`,
  },
  {
    id: "plugins",
    label: "UI plugins",
    icon: Puzzle,
    lede: () =>
      "Small, trusted additions to the workspace. Preferences stay in this browser.",
  },
  {
    id: "general",
    label: "Appearance",
    icon: Palette,
    lede: () => "How Raphie looks in this browser, for every bot.",
  },
  {
    id: "telemetry",
    label: "Diagnostics",
    icon: Radio,
    lede: (bot: string) =>
      `Timings and failures from ${bot}’s runs. Nothing leaves this backend.`,
  },
] as const;

export type Section = (typeof sections)[number]["id"];

export const isSection = (value: unknown): value is Section =>
  sections.some((section) => section.id === value);

export const isAppSection = (section: string) =>
  ["connection", "general", "plugins"].includes(section);

export const sectionOf = (id: Section) =>
  sections.find((section) => section.id === id)!;

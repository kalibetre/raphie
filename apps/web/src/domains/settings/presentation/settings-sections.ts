import {
  BookOpen,
  Bot,
  Box,
  Brain,
  Clock,
  FolderOpen,
  History,
  KeyRound,
  Library,
  ListTree,
  LogOut,
  MessagesSquare,
  Palette,
  Plug,
  Puzzle,
  Radio,
  Sparkles,
  UserRound,
} from "lucide-react";

/**
 * Every settings page. Ids are URL values (`?section=`), so they never change.
 * `lede` introduces the page in the voice of the bot it configures.
 */
export const sections = [
  {
    id: "sandbox",
    label: "Sandbox",
    icon: Box,
    lede: (bot: string) =>
      `How ${bot} runs commands, with the active execution provider and its limits.`,
  },
  {
    id: "workspace",
    label: "Workspace",
    icon: FolderOpen,
    lede: (bot: string) =>
      `The files ${bot} keeps between conversations. Browse folders and download saved work.`,
  },
  {
    id: "mcp",
    label: "MCP tools",
    icon: Plug,
    lede: (bot: string) =>
      `Connect the tools ${bot} can use. Every connection belongs to this bot.`,
  },
  {
    id: "channels",
    label: "Channels",
    icon: MessagesSquare,
    lede: (bot: string) => `Connect ${bot} to messaging channels.`,
  },
  {
    id: "jobs",
    label: "Scheduled jobs",
    icon: Clock,
    lede: (bot: string) =>
      `Give ${bot} reminders and recurring work, with results saved in a conversation.`,
  },
  {
    id: "bot",
    label: "Profile",
    icon: UserRound,
    lede: (bot: string) =>
      `The identity, color and personality ${bot} brings to your conversations.`,
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
    id: "account",
    label: "Account",
    icon: LogOut,
    lede: () => "The administrator signed in to this Raphie server.",
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
    id: "activity",
    label: "Activity",
    icon: ListTree,
    lede: (bot: string) =>
      `Recent activity from ${bot}, across its conversations.`,
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
  ["account", "general", "plugins"].includes(section);

export const sectionOf = (id: Section) =>
  sections.find((section) => section.id === id)!;

/** Sub-pages reached from inside a page; their parent is the page to go back to. */
export const parentSection: Partial<Record<Section, Section>> = {
  "bot-history": "bot",
  personality: "bot",
  "memory-browse": "memory",
};

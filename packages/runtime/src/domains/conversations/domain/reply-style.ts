import type { ReplyStyle } from "@raphie/contracts";

/** Short, plain replies: the owner reads the answer first. */
export const DEFAULT_REPLY_STYLE: ReplyStyle = {
  length: "short",
  warmth: "default",
  formatting: "default",
  emoji: false,
};

/** A stored style, with any setting it predates at its default. */
export function replyStyleOf(stored: Partial<ReplyStyle> | undefined) {
  return { ...DEFAULT_REPLY_STYLE, ...stored };
}

const FORMATTING: Record<ReplyStyle["formatting"], string> = {
  prose:
    "Add only what the owner needs to act on it, in short plain paragraphs; use a list or table only for steps or a comparison.",
  default:
    "Add only what the owner needs to act on it, as a short list or table rather than paragraphs.",
  structured:
    "Add what the owner needs to act on it, organised with short headings, lists and tables so it can be scanned.",
};

const LENGTH: Record<ReplyStyle["length"], string> = {
  short:
    "Most replies fit in under 80 words; go longer only when the owner asks for detail or the work itself is long, such as code or a draft they asked for.",
  balanced:
    "Most replies fit in under 150 words, with a line of context or reasoning where it helps; go longer when the owner asks for detail or the work itself is long.",
  detailed:
    "Explain fully when it helps: the reasoning, trade-offs and caveats the owner would want, with every sentence earning its place.",
};

const WARMTH: Record<ReplyStyle["warmth"], string> = {
  plain:
    "Keep the tone plain and matter-of-fact: no pleasantries or exclamation marks.",
  default: "",
  warm: "Write warmly and personably, like a friendly colleague, without adding length.",
};

/**
 * How a bot writes a reply, from the owner's settings for it. At the
 * defaults, the owner reads the answer first and does not wade through text
 * to find it. The bot's personality, which the owner also wrote, can ask for
 * something else.
 */
export function replyInstructions(style: ReplyStyle = DEFAULT_REPLY_STYLE) {
  return `${[
    "Replies: open with the answer, or the one question you need answered, in one or two sentences as their own paragraph.",
    FORMATTING[style.formatting],
    "No preamble, no restating the request, no closing summary or offers of more help.",
    LENGTH[style.length],
    WARMTH[style.warmth],
    style.emoji
      ? "An occasional emoji is welcome where it adds warmth or clarity."
      : "",
    "If the personality the owner wrote asks for a different length or format, follow it.",
  ]
    .filter(Boolean)
    .join(" ")}\n`;
}

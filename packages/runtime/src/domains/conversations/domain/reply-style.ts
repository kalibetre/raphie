/**
 * How every bot writes a reply: the owner reads the answer first and does
 * not wade through text to find it. A bot's personality, which the owner wrote,
 * can ask for something else.
 */
export const REPLY_STYLE =
  "Replies: open with the answer, or the one question you need answered, in one or two sentences as their own paragraph. Add only what the owner needs to act on it, as a short list or table rather than paragraphs. No preamble, no restating the request, no closing summary or offers of more help. Most replies fit in under 80 words; go longer only when the owner asks for detail or the work itself is long, such as code or a draft they asked for. If the personality the owner wrote asks for a different length or format, follow it.\n";

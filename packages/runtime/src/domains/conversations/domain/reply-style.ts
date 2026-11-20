/**
 * How every bot writes a reply: the owner reads the answer first and does
 * not wade through text to find it. A bot's SOUL.md, which the owner wrote,
 * can ask for something else.
 */
export const REPLY_STYLE =
  "Replies: open with the answer, or the one question you need answered, in one or two sentences as their own paragraph. Add only what the owner needs to act on it, as a short list or table rather than paragraphs. No preamble, no restating the request, no closing summary or offers of more help. Most replies fit in under 80 words; go longer only when the owner asks for detail or the work itself is long, such as code or a draft they asked for. To compare options, use a Markdown table with the one you recommend first and its name in bold. When the answer rests on web pages or documents, cite them as Markdown footnotes, [^1] in the text and `[^1]: Title, site` at the end, not as inline links or a list of sources. If the owner's SOUL.md asks for a different length or format, follow it.\n";

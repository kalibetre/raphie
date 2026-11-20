const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";

const DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]?(.*)$/;

const REFERENCE = /\[\^([^\]\s]+)\]/g;

const FENCE = /^ {0,3}(```|~~~)/;

/** `n` in superscript digits: 12 is "¹²". */
export function superscript(n: number) {
  return String(n).replace(/\d/g, (digit) => SUPERSCRIPT[Number(digit)]!);
}

/**
 * A reply's Markdown footnotes for a channel that shows plain text, as the
 * desktop app shows them: each reference becomes a superscript number, in
 * the order the text first cites it, and the notes follow the reply as
 * "¹ Source". A reference with no note stays as written; a note nothing
 * cites is dropped, as Markdown does. Code is left alone.
 */
export function plainFootnotes(text: string) {
  const notes = new Map<string, string>();
  const body: string[] = [];
  let fenced = false;
  let note: string | undefined;
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) fenced = !fenced;
    const definition = fenced ? null : DEFINITION.exec(line);
    if (definition) {
      note = definition[1]!;
      notes.set(note, definition[2]!.trim());
      continue;
    }
    if (note && /^( {2,}|\t)\S/.test(line)) {
      notes.set(note, `${notes.get(note)} ${line.trim()}`.trim());
      continue;
    }
    note = undefined;
    body.push(line);
  }
  if (!notes.size) return text;
  const order: string[] = [];
  fenced = false;
  const cited = body.map((line) => {
    if (FENCE.test(line)) fenced = !fenced;
    if (fenced) return line;
    // Odd segments are inline code.
    return line
      .split(/(`[^`]*`)/)
      .map((part, n) =>
        n % 2
          ? part
          : part.replace(REFERENCE, (whole, label: string) => {
              if (!notes.has(label)) return whole;
              if (!order.includes(label)) order.push(label);
              return superscript(order.indexOf(label) + 1);
            }),
      )
      .join("");
  });
  const reply = cited.join("\n").trimEnd();
  if (!order.length) return reply;
  return `${reply}\n\n${order
    .map((label, n) => `${superscript(n + 1)} ${notes.get(label)}`)
    .join("\n")}`;
}

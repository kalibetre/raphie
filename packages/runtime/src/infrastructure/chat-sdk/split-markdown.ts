/** A line that opens or closes a fenced code block. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Splits a reply into chunks of at most `size` characters, at a line break
 * where it can, else at a space, never inside a surrogate pair. A code block
 * cut across chunks is closed at the end of one and reopened, with its
 * language, at the start of the next, so each chunk renders on its own.
 */
export function splitMarkdown(text: string, size: number) {
  if (!text) return [];
  const parts: string[] = [];
  let fence: { marker: string; opening: string } | null = null;
  // What a chunk starts with: the open code block's fence line, if any.
  const header = () => (fence ? `${fence.opening}\n` : "");
  const closing = () => (fence ? `\n${fence.marker}` : "");
  let chunk = "";
  const flush = () => {
    parts.push(chunk.replace(/\n$/, "") + closing());
    chunk = header();
  };
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    let piece = index === lines.length - 1 ? line : `${line}\n`;
    while (chunk.length + piece.length + closing().length > size) {
      if (chunk !== header()) {
        flush();
        continue;
      }
      // One line longer than a whole chunk: cut it at a space where it can.
      const room = size - chunk.length - closing().length;
      const window = piece.slice(0, room);
      const space = window.lastIndexOf(" ");
      let cut = space > room / 2 ? space + 1 : room;
      if (/[\uD800-\uDBFF]/.test(piece[cut - 1] ?? "")) cut--;
      chunk += piece.slice(0, cut);
      piece = piece.slice(cut);
      flush();
    }
    chunk += piece;
    const marker = FENCE.exec(line)?.[1];
    if (!marker) continue;
    if (!fence) {
      // A fence line too long to repeat in every chunk is not reopened.
      if (line.length <= size / 4) fence = { marker, opening: line };
    } else if (
      marker[0] === fence.marker[0] &&
      marker.length >= fence.marker.length &&
      line.trim() === marker
    )
      fence = null;
  }
  if (chunk && chunk !== header()) parts.push(chunk);
  return parts;
}

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export function attachmentName(name: string): string {
  const cleaned =
    name
      .replaceAll("\\", "/")
      .split("/")
      .at(-1)!
      // oxlint-disable-next-line no-control-regex -- Strip ASCII controls from untrusted display names.
      .replace(/[\x00-\x1f\x7f]/g, "")
      .slice(0, 160) || "attachment";
  return cleaned === "." || cleaned === ".." ? "attachment" : cleaned;
}

/** Detect supported raster image formats from bytes, never browser MIME claims. */
export function imageMime(bytes: Uint8Array): string | undefined {
  const b = bytes;
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...b.subarray(start, end));
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => b[i] === value))
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return undefined;
}

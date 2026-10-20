export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export function attachmentName(name: string): string {
  return (
    name
      .replaceAll("\\", "/")
      .split("/")
      .at(-1)!
      // oxlint-disable-next-line no-control-regex -- Strip ASCII controls from untrusted display names.
      .replace(/[\x00-\x1f\x7f]/g, "")
      .slice(0, 160) || "attachment"
  );
}

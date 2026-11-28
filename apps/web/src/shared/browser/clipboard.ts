/**
 * Puts `text` on the clipboard. Over plain HTTP away from localhost the
 * browser has no clipboard API, so it falls back to the older copy command.
 * Resolves whether it worked.
 */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    // oxlint-disable-next-line typescript/no-deprecated -- the only copy without the clipboard API
    const done = document.execCommand("copy");
    field.remove();
    return done;
  }
}

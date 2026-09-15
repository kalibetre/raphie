/**
 * Copies a value to the system clipboard via `pbcopy`, the same native
 * shell-out pattern as `pickFolderNative`. `printf '%s'` (not `echo`) so no
 * trailing newline is added to a copied EnvVar value. Bun's shell escapes
 * interpolated `${}` values, so this is safe against shell injection.
 */
export async function copyToClipboard(value: string): Promise<void> {
  if (typeof Bun === 'undefined') return
  try {
    await Bun.$`printf '%s' ${value} | pbcopy`.quiet()
  } catch {
    // clipboard unavailable — nothing more to do
  }
}

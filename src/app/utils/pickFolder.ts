/**
 * Native macOS folder picker via Bun's own shell (`Bun.$`), not Node's
 * child_process. Referenced off the `Bun` global rather than `import { $ }
 * from 'bun'` so this file can still load under vitest, which has no `bun`
 * package in its module graph.
 */
export async function pickFolderNative(): Promise<string | null> {
  if (typeof Bun === 'undefined') return null
  try {
    const output = await Bun.$`osascript -e 'POSIX path of (choose folder)'`.text()
    return output.trim() || null
  } catch {
    return null // user cancelled
  }
}

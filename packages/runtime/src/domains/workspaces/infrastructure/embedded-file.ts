import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * A file built into the standalone executable, by its path from the
 * executable's root. A release is one executable whose runtime is a second
 * entry point, so its own `import.meta.url` is not that root; `Bun.main`,
 * the executable's first entry point, is in every process it starts.
 */
export const embeddedFile = (path: string) =>
  new URL(path, pathToFileURL(`${dirname(Bun.main)}/`));

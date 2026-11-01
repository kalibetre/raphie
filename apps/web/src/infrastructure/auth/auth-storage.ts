import { randomBytes } from "node:crypto";
import {
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export { dataDirectory as authDirectory } from "../../../../../shared/data-directory.ts";

export { webOrigins } from "../../../../../shared/web-origins.ts";

/**
 * Better Auth's signing secret. It is created once beside the database so a
 * data backup is complete. A lost secret only signs everyone out; a readable
 * or malformed one is refused rather than replaced.
 */
export function authSecret(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "auth.secret");
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString("hex")}`;
  try {
    // Publish atomically so a concurrent reader never sees a partial secret.
    writeFileSync(temporary, `${randomBytes(32).toString("base64url")}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    linkSync(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      /* Already removed. */
    }
  }
  const info = lstatSync(path);
  if (!info.isFile() || info.mode & 0o077)
    throw new Error(
      "auth.secret must be a regular file accessible only by its owner (chmod 600).",
    );
  const secret = readFileSync(path, "utf8").trim();
  if (secret.length < 43)
    throw new Error(
      "auth.secret is malformed. Restore it from a backup, or delete it to sign every browser out.",
    );
  return secret;
}

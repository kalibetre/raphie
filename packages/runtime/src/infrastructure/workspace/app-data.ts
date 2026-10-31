import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export { dataDirectory as appDataDirectory } from "../../../../../shared/data-directory.ts";

export async function appDataIdentity(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "workspace-identity.json");
  try {
    await writeFile(path, JSON.stringify({ id: crypto.randomUUID() }), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const value = JSON.parse(await readFile(path, "utf8"));
  if (typeof value.id !== "string" || !/^[\da-f-]{36}$/.test(value.id))
    throw new Error(
      "Invalid workspace identity. Restore its backup; do not reset it.",
    );
  return { id: value.id as string, directory: resolve(directory) };
}

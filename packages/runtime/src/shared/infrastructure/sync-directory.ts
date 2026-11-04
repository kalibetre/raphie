import { constants } from "node:fs";
import { open } from "node:fs/promises";

/** Persist directory entries before committing a reference in another store. */
export async function syncDirectory(path: string) {
  const directory = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

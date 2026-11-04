import { constants } from "node:fs";
import { link, mkdir, open, realpath, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { syncDirectory } from "../../../shared/infrastructure/sync-directory.ts";

/** Guest-only upload publication; a killed write never leaves a partial final file. */
export async function writeUpload(path: string, bytes: Uint8Array) {
  if (
    !/^\/workspace\/uploads\/[a-f0-9]{64}\/[^/]+$/.test(path) ||
    bytes.length > 8 * 1024 * 1024
  )
    throw new Error("Invalid upload");
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  if ((await realpath(parent)) !== parent)
    throw new Error("Upload parent is a symbolic link");
  const temporary = join(parent, `.upload-${crypto.randomUUID()}`);
  try {
    const file = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o644,
    );
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const stat = await existing.stat();
        if (
          !stat.isFile() ||
          stat.size !== bytes.length ||
          !Buffer.from(await existing.readFile()).equals(bytes)
        )
          throw new Error("Upload path changed");
      } finally {
        await existing.close();
      }
    }
    for (const directory of [
      parent,
      dirname(parent),
      "/workspace/uploads",
      "/workspace",
    ])
      await syncDirectory(directory);
  } finally {
    await rm(temporary, { force: true });
  }
}

import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import type { CredentialKeyStore } from "./credential-cipher.ts";

/** One installation master, outside its data directory. Never an OS-store fallback. */
export function fileCredentialKeyStore(path: string): CredentialKeyStore {
  const parent = dirname(path);
  const checkDirectory = async () => {
    if (!isAbsolute(path) || process.getuid === undefined) throw new Error();
    const info = await lstat(parent);
    if (
      !info.isDirectory() ||
      info.uid !== process.getuid() ||
      (info.mode & 0o777) !== 0o700
    )
      throw new Error();
  };
  return {
    async get() {
      try {
        await checkDirectory();
        const file = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          const info = await file.stat();
          if (
            !info.isFile() ||
            info.uid !== process.getuid!() ||
            (info.mode & 0o777) !== 0o600 ||
            info.nlink !== 1 ||
            info.size > 45
          )
            throw new Error();
          const value = await file.readFile("utf8");
          if (!/^[A-Za-z0-9+/]{43}=\n?$/.test(value)) throw new Error();
          return value.trimEnd();
        } finally {
          await file.close();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async set(_name, value) {
      if (!isAbsolute(path) || !/^[A-Za-z0-9+/]{43}=$/.test(value))
        throw new Error();
      await mkdir(parent, { mode: 0o700 }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        },
      );
      await checkDirectory();
      // Exclusive creation preserves existing keys, including malformed/partial files.
      const file = await open(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(value + "\n", "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      const directory = await open(parent, constants.O_RDONLY);
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    },
  };
}

import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type ReleaseChannel = "stable" | "nightly";

function validate(value: string): ReleaseChannel {
  if (value !== "stable" && value !== "nightly")
    throw new Error("Choose either stable or nightly.");
  return value;
}

export function userInstallChannel(
  directory: string,
  requested?: string,
): ReleaseChannel {
  const marker = join(directory, ".raphie-user-install");
  try {
    if (!readFileSync(marker, "utf8").trim()) throw new Error();
  } catch {
    throw new Error(
      "Release channels are available for a user installation only.",
    );
  }
  const channelFile = join(directory, ".channel");
  if (requested === undefined) {
    try {
      return validate(readFileSync(channelFile, "utf8").trim());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "stable";
      throw error;
    }
  }
  const channel = validate(requested);
  const lock = join(dirname(directory), ".raphie-install.lock");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch {
    throw new Error("Another Raphie installation or update is in progress.");
  }
  const temporary = join(
    directory,
    `.channel.${process.pid}.${crypto.randomUUID()}`,
  );
  try {
    writeFileSync(temporary, `${channel}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, channelFile);
    return channel;
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      /* Already renamed. */
    }
    rmdirSync(lock);
  }
}

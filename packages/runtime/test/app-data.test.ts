import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appDataDirectory,
  appDataIdentity,
} from "../src/infrastructure/workspace/app-data.ts";

test("worktrees reuse a stable default, preserve explicit paths and refuse ambiguous legacy data", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "raphie-data-")));
  try {
    execFileSync("git", ["init", "--quiet", root]);
    const checkout = join(root, "checkout");
    await mkdir(checkout);
    await writeFile(
      join(checkout, ".git"),
      `gitdir: ${root}/.git/worktrees/test\n`,
    );
    await mkdir(join(root, ".git/worktrees/test"), { recursive: true });
    await writeFile(join(root, ".git/worktrees/test/commondir"), "../..\n");
    await writeFile(
      join(root, ".git/worktrees/test/HEAD"),
      "ref: refs/heads/test\n",
    );
    expect(appDataDirectory(checkout)).toBe(join(root, ".data"));
    const identity = await appDataIdentity(appDataDirectory(root));
    expect(await appDataIdentity(appDataDirectory(checkout))).toEqual(identity);
    await mkdir(join(checkout, ".data"));
    await writeFile(join(checkout, ".data/sentinel"), "untouched");
    expect(() => appDataDirectory(checkout)).toThrow(
      "Set DATA_DIRECTORY explicitly",
    );
    expect(appDataDirectory(checkout, ".data")).toBe(join(checkout, ".data"));
    expect(appDataDirectory(checkout, identity.directory)).toBe(
      identity.directory,
    );
    expect(await Bun.file(join(checkout, ".data/sentinel")).text()).toBe(
      "untouched",
    );
    expect(await appDataIdentity(root)).not.toEqual(identity);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

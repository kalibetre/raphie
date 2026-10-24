import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
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

test("app data rejects another live owner and recovers ownership after SIGKILL", async () => {
  const { ownAppData } =
    await import("../src/infrastructure/workspace/app-data-owner.ts");
  const directory = await mkdtemp(join(tmpdir(), "raphie-data-owner-"));
  const child = spawn(
    process.execPath,
    [
      new URL("./app-data-owner-worker.ts", import.meta.url).pathname,
      directory,
    ],
    { env: {}, stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Owner fixture did not start")),
        5000,
      );
      child.stdout.once("data", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error("Owner fixture exited early"));
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    await assert.rejects(ownAppData(directory), /already owned/);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const owner = await ownAppData(directory);
    try {
      await assert.rejects(ownAppData(directory), /already owned/);
    } finally {
      owner.close();
    }
    (await ownAppData(directory)).close();
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

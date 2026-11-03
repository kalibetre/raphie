import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { userInstallChannel } from "./user-install-channel.ts";

test("user channel defaults to stable, persists switches, and refuses invalid or concurrent changes", () => {
  const root = mkdtempSync(join(tmpdir(), "raphie-channel-"));
  try {
    const dir = join(root, "raphie");
    mkdirSync(dir);
    assert.throws(() => userInstallChannel(dir), /user installation only/);
    writeFileSync(join(dir, ".raphie-user-install"), "v0.0.4-alpha.3\n");
    assert.equal(userInstallChannel(dir), "stable");
    assert.equal(userInstallChannel(dir, "nightly"), "nightly");
    assert.equal(userInstallChannel(dir), "nightly");
    assert.throws(() => userInstallChannel(dir, "alpha"), /stable or nightly/);
    mkdirSync(join(root, ".raphie-install.lock"));
    assert.throws(() => userInstallChannel(dir, "stable"), /in progress/);
    assert.equal(readFileSync(join(dir, ".channel"), "utf8"), "nightly\n");
    rmdirSync(join(root, ".raphie-install.lock"));
    writeFileSync(join(dir, ".channel"), "alpha\n");
    assert.throws(() => userInstallChannel(dir), /stable or nightly/);
    assert.equal(userInstallChannel(dir, "stable"), "stable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CredentialCipher } from "../src/domains/settings/infrastructure/credential-cipher.ts";
import { fileCredentialKeyStore } from "../src/domains/settings/infrastructure/file-credential-key-store.ts";

test("file-backed credentials survive restart, share the installation key, and fail closed after key loss", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-file-key-"));
  const path = join(directory, "private", "master-key");
  const store = () => fileCredentialKeyStore(path);
  try {
    const first = await CredentialCipher.open(store());
    const encrypted = first.encrypt("SYNTHETIC_CREDENTIAL", "one", "provider")!;
    const original = await readFile(path);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(directory, "private"))).mode & 0o777, 0o700);
    const keyId = first.keyId;
    first.close();
    const reopened = await CredentialCipher.open(store(), keyId);
    assert.equal(
      reopened.decrypt(encrypted, "one", "provider"),
      "SYNTHETIC_CREDENTIAL",
    );
    reopened.close();
    // A new bot/database uses the same master without replacing its key file.
    const bot = await CredentialCipher.open(store());
    assert.notEqual(bot.keyId, keyId);
    bot.close();
    assert.deepEqual(await readFile(path), original);
    await assert.rejects(store().set(keyId, original.toString().trimEnd()));
    assert.deepEqual(await readFile(path), original);
    await rm(path);
    await assert.rejects(CredentialCipher.open(store(), keyId), /key missing/);
    await assert.rejects(stat(path), { code: "ENOENT" });
    await writeFile(path, original, { mode: 0o600 });
    const restored = await CredentialCipher.open(store(), keyId);
    assert.equal(
      restored.decrypt(encrypted, "one", "provider"),
      "SYNTHETIC_CREDENTIAL",
    );
    restored.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("file store rejects exposed, linked, malformed, and relative key paths without replacement or secret errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-unsafe-key-"));
  const privateDir = join(directory, "private");
  const path = join(privateDir, "master-key");
  const store = fileCredentialKeyStore(path);
  const denied = () =>
    assert.rejects(CredentialCipher.open(store), (error: Error) => {
      assert.match(error.message, /unavailable/);
      assert.doesNotMatch(error.message, /SYNTHETIC|raphie-unsafe-key/);
      return true;
    });
  try {
    await mkdir(privateDir, { mode: 0o700 });
    await writeFile(path, "SYNTHETIC_INVALID_KEY", { mode: 0o600 });
    await denied();
    assert.equal(await readFile(path, "utf8"), "SYNTHETIC_INVALID_KEY");
    await rm(path);
    const cipher = await CredentialCipher.open(store);
    cipher.close();
    await chmod(path, 0o644);
    await denied();
    await chmod(path, 0o600);
    await chmod(privateDir, 0o755);
    await denied();
    await chmod(privateDir, 0o700);
    const target = join(privateDir, "target");
    await link(path, target);
    await denied();
    await rm(path);
    await symlink(target, path);
    await denied();
    await rm(path);
    await symlink(join(directory, "missing"), path);
    await denied();
    await rm(path);
    await mkdir(path);
    await denied();
    await assert.rejects(
      CredentialCipher.open(fileCredentialKeyStore("relative/master-key")),
      /unavailable/,
    );
    await assert.rejects(
      CredentialCipher.open(fileCredentialKeyStore("")),
      /unavailable/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

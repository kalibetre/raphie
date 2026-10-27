import { Database } from "bun:sqlite";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OwnerStore } from "../src/infrastructure/auth/owner-store.ts";

test("owner credentials and revocable sessions survive restart without storing plaintext", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-owner-"));
  const path = join(directory, "auth.sqlite");
  let store = new OwnerStore(path);
  try {
    assert.equal(store.configured(), false);
    await assert.rejects(store.setOwner("owner", "short"));
    await store.setOwner("owner", "synthetic password one");
    assert.equal(await store.signIn("other", "synthetic password one"), null);
    assert.equal(await store.signIn("owner", "incorrect password"), null);
    const token = (await store.signIn(
      "owner",
      "synthetic password one",
      1000,
    ))!;
    assert.ok(store.valid(token, 1001));
    assert.equal(store.valid(token, 1000 + 30 * 24 * 60 * 60 * 1000), false);
    store.close();
    const db = new Database(path, { readonly: true });
    const owner = db.query("SELECT password_hash FROM owner").get() as {
      password_hash: string;
    };
    const session = db.query("SELECT token_hash FROM sessions").get() as {
      token_hash: string;
    };
    assert.match(owner.password_hash, /^\$argon2id\$/);
    assert.notEqual(session.token_hash, token);
    db.close();
    store = new OwnerStore(path);
    assert.ok(store.valid(token, 1001));
    await store.setOwner("owner", "synthetic password two");
    assert.equal(store.valid(token, 1001), false);
    const second = (await store.signIn("owner", "synthetic password two"))!;
    store.signOut(second);
    assert.equal(store.valid(second), false);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

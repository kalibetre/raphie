import { Database } from "bun:sqlite";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PairingStore } from "../src/infrastructure/auth/pairing-store.ts";

test("one-time pairing codes create individually revocable devices across restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-pairing-"));
  const path = join(directory, "pairing.sqlite");
  let first = new PairingStore(path);
  let second = new PairingStore(path);
  try {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const code = first.createCode(1000, 100);
    const device = second.redeem(code.secret, " My phone ", 1099);
    assert.ok(device);
    assert.equal(first.redeem(code.secret, "replay", 1099), null);
    assert.equal(first.valid(device.credential, 1100), true);
    assert.deepEqual(
      first.list().map((item) => item.label),
      ["My phone"],
    );
    const inspection = new Database(path, { readonly: true });
    try {
      const row = inspection
        .query<{ credential_hash: string }, []>(
          "SELECT credential_hash FROM paired_devices",
        )
        .get();
      assert.ok(row);
      assert.notEqual(row.credential_hash, device.credential);
    } finally {
      inspection.close();
    }
    const expired = first.createCode(1000, 100);
    assert.equal(second.redeem(expired.secret, "expired", 1100), null);
    const cancelled = first.createCode(1000, 100);
    first.cancelCode(cancelled.secret);
    assert.equal(second.redeem(cancelled.secret, "cancelled", 1001), null);
    first.close();
    second.close();
    first = new PairingStore(path);
    second = new PairingStore(path);
    assert.equal(first.valid(device.credential, 1200), true);
    assert.equal(second.revoke(device.id, 1300), true);
    assert.equal(first.valid(device.credential, 1400), false);
    assert.equal(second.revoke(device.id, 1400), false);
  } finally {
    first.close();
    second.close();
    await rm(directory, { recursive: true, force: true });
  }
});

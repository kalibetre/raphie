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

test("two processes cannot redeem the same code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-pairing-race-"));
  const path = join(directory, "pairing.sqlite");
  const store = new PairingStore(path);
  try {
    const code = store.createCode();
    const modulePath = new URL(
      "../src/infrastructure/auth/pairing-store.ts",
      import.meta.url,
    ).href;
    const program = `import { PairingStore } from ${JSON.stringify(modulePath)};
      const store = new PairingStore(process.argv[1]);
      const secret = await Bun.stdin.text();
      const result = store.redeem(secret, "Race fixture");
      store.close();
      console.log(result ? "redeemed" : "rejected");`;
    const children = [0, 1].map(() =>
      Bun.spawn([process.execPath, "-e", program, path], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    for (const child of children) {
      await child.stdin.write(code.secret);
      await child.stdin.end();
    }
    const outcomes = await Promise.all(
      children.map(async (child) => {
        const [status, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        assert.equal(status, 0, stderr);
        return stdout.trim();
      }),
    );
    assert.deepEqual(outcomes.sort(), ["redeemed", "rejected"]);
    assert.equal(store.list().length, 1);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

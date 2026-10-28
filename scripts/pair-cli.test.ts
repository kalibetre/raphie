import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PairingStore } from "../apps/web/src/infrastructure/auth/pairing-store.ts";

test("experimental pair command requires a terminal and issues a redeemable one-time link", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-pair-cli-"));
  try {
    const env = {
      ...process.env,
      DATA_DIRECTORY: directory,
      RAPHIE_WEB_ORIGIN: "https://raphie.example",
    };
    const nonInteractive = Bun.spawnSync(
      [process.execPath, "scripts/raphie.ts", "pair"],
      { env, stdout: "pipe", stderr: "pipe" },
    );
    assert.notEqual(nonInteractive.exitCode, 0);
    assert.match(nonInteractive.stderr.toString(), /interactive terminal/);
    const python = `import os, pty, subprocess, sys\nmaster, slave = pty.openpty()\np = subprocess.Popen([sys.argv[1], 'scripts/raphie.ts', 'pair'], stdin=slave, stdout=slave, stderr=slave, env=os.environ)\nos.close(slave)\nbuf = b''\nwhile True:\n try:\n  chunk = os.read(master, 4096)\n  if not chunk: break\n  buf += chunk\n except OSError: break\nos.close(master)\nsys.stdout.buffer.write(buf)\nsys.exit(p.wait())`;
    const interactive = Bun.spawnSync(
      ["python3", "-c", python, process.execPath],
      { env, stdout: "pipe", stderr: "pipe" },
    );
    assert.equal(interactive.exitCode, 0);
    const output = interactive.stdout.toString();
    const match =
      /https:\/\/raphie\.example\/auth\/pairing\/page#token=([A-Za-z0-9_-]{43})/.exec(
        output,
      );
    assert.ok(match);
    const store = new PairingStore(join(directory, "pairing.sqlite"));
    try {
      const device = store.redeem(match[1]!, "Fixture");
      assert.ok(device);
      assert.equal(store.redeem(match[1]!, "Replay"), null);
      const list = Bun.spawnSync(
        [process.execPath, "scripts/raphie.ts", "devices", "list"],
        { env, stdout: "pipe", stderr: "pipe" },
      );
      assert.equal(list.exitCode, 0);
      assert.match(list.stdout.toString(), /Fixture/);
      const revoke = Bun.spawnSync(
        [process.execPath, "scripts/raphie.ts", "devices", "revoke", device.id],
        { env, stdout: "pipe", stderr: "pipe" },
      );
      assert.equal(revoke.exitCode, 0);
      assert.equal(store.isValid(device.credential), false);
    } finally {
      store.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import { test } from "bun:test";
import assert from "node:assert/strict";

test("standalone help describes service commands without requiring an installation", () => {
  const run = (...args: string[]) =>
    Bun.spawnSync(["sh", "scripts/linux-binary/raphie-admin", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
  for (const args of [[], ["--help"], ["-h"], ["help"]]) {
    const result = run(...args);
    assert.equal(result.exitCode, 0);
    const output = result.stdout.toString();
    for (const command of [
      "status",
      "health",
      "auth setup",
      "auth recover",
      "update",
      "restore",
      "uninstall",
      "--purge",
    ]) {
      assert.ok(output.includes(command), `missing ${command}`);
    }
    assert.match(output, /preserv/i);
    assert.match(output, /systemctl/);
  }
  for (const command of ["update", "restore", "uninstall"]) {
    const result = run(command, "--help");
    assert.equal(result.exitCode, 0);
    assert.match(
      result.stdout.toString(),
      new RegExp(`Usage: sudo raphie ${command}`),
    );
  }
  assert.match(run("uninstall", "--help").stdout.toString(), /confirmation/i);
});

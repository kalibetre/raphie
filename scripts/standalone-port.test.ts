import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("port reports the running service port and falls back to readable installation configuration", () => {
  const directory = mkdtempSync(join(tmpdir(), "raphie-port-"));
  try {
    const metadata = join(directory, "web-port");
    const config = join(directory, "raphie.conf");
    for (const entry of [
      "scripts/linux-binary/raphie-admin",
      "scripts/linux-install/raphie",
    ]) {
      const script = readFileSync(entry, "utf8")
        .replaceAll("/run/raphie/web-port", metadata)
        .replaceAll("/etc/raphie/raphie.conf", config);
      const run = (...args: string[]) =>
        Bun.spawnSync(["sh", "-c", script, "raphie", ...args], {
          stdout: "pipe",
          stderr: "pipe",
        });
      writeFileSync(config, "RAPHIE_WEB_PORT=4320\n");
      writeFileSync(metadata, "41837\n");
      assert.equal(run("port").stdout.toString(), "41837\n");
      rmSync(metadata);
      assert.equal(run("port").stdout.toString(), "4320\n");
      assert.notEqual(run("port", "extra").exitCode, 0);
      writeFileSync(config, "RAPHIE_WEB_PORT=invalid\n");
      assert.notEqual(run("port").exitCode, 0);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

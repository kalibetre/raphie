import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("standalone origins validate, preserve configuration, restart and roll back on failure", () => {
  const directory = mkdtempSync(join(tmpdir(), "raphie-origins-"));
  try {
    const script = readFileSync("scripts/linux-binary/raphie-admin", "utf8")
      .split("<<'RAPHIE_ORIGINS_PY'\n")[1]!
      .split("\nRAPHIE_ORIGINS_PY")[0]!;
    const config = join(directory, "raphie.conf");
    const lock = join(directory, "lock");
    const calls = join(directory, "calls");
    const failure = join(directory, "failure");
    const original =
      "DATA_DIRECTORY=/var/lib/raphie/data\nRAPHIE_WEB_ORIGIN=http://127.0.0.1:4320\nRAPHIE_WEB_PORT=4320\n";
    writeFileSync(config, original, { mode: 0o600 });
    const systemctl = join(directory, "systemctl");
    writeFileSync(
      systemctl,
      `#!/bin/sh\necho restart >> "$TEST_CALLS"\nif [ -e "$TEST_FAILURE" ]; then rm "$TEST_FAILURE"; exit 1; fi\n`,
    );
    chmodSync(systemctl, 0o755);
    const run = (action: string, ...args: string[]) =>
      Bun.spawnSync(["python3", "-c", script, action, config, lock, ...args], {
        env: {
          ...process.env,
          PATH: `${directory}:/usr/bin:/bin`,
          TEST_CALLS: calls,
          TEST_FAILURE: failure,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
    assert.equal(
      run("set-origins", "https://one.example,http://evil.example").exitCode,
      1,
    );
    assert.equal(readFileSync(config, "utf8"), original);
    assert.equal(run("set-origins", "https://localhost:4320").exitCode, 1);
    assert.equal(
      run(
        "set-origins",
        "http://localhost:4320,https://one.example,https://two.example:8443",
      ).exitCode,
      0,
    );
    const updated = readFileSync(config, "utf8");
    assert.ok(updated.startsWith(original));
    assert.ok(
      updated.includes(
        "RAPHIE_WEB_ALLOWED_ORIGINS=https://one.example,https://two.example:8443\n",
      ),
    );
    assert.match(run("origins").stdout.toString(), /https:\/\/one\.example/);
    writeFileSync(failure, "fail once");
    assert.equal(run("set-origins", "https://replacement.example").exitCode, 1);
    assert.equal(readFileSync(config, "utf8"), updated);
    assert.equal(run("set-origins", "").exitCode, 0);
    assert.ok(
      readFileSync(config, "utf8").includes("RAPHIE_WEB_ALLOWED_ORIGINS=\n"),
    );
    assert.equal(readFileSync(calls, "utf8").trim().split("\n").length, 4);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

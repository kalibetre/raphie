import { test } from "bun:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("raphie logs shows the background service's log, and follows it on request", async () => {
  const root = await mkdtemp(join(tmpdir(), "raphie-logs-"));
  const home = join(root, "home");
  const stubs = join(root, "bin");
  await mkdir(home);
  await mkdir(stubs);
  // journalctl notes how it was asked, in place of the systemd journal.
  await writeFile(
    join(stubs, "journalctl"),
    `#!/bin/sh\nprintf 'journalctl %s\\n' "$*"\n`,
  );
  await chmod(join(stubs, "journalctl"), 0o755);
  const logs = (...args: string[]) =>
    Bun.spawnSync(
      [process.execPath, resolve("scripts/raphie.ts"), "logs", ...args],
      {
        env: {
          ...process.env,
          HOME: home,
          PATH: `${stubs}:${process.env.PATH}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
  try {
    // Nothing set up yet: it says where Raphie's output goes instead.
    const none = logs();
    assert.equal(none.exitCode, 0, none.stderr.toString());
    assert.match(none.stdout.toString(), /raphie start --foreground/);

    if (process.platform === "darwin") {
      const folder = join(home, "Library/Logs/Raphie");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "service.log"), "one\ntwo\nthree\n");
      await writeFile(join(folder, "service-error.log"), "warned\n");
      const shown = logs("-n", "2");
      assert.equal(shown.exitCode, 0, shown.stderr.toString());
      const out = shown.stdout.toString();
      assert.match(out, /service\.log <==\ntwo\nthree\n/);
      assert.match(out, /service-error\.log <==\nwarned\n/);
      assert.doesNotMatch(out, /\bone\b/);
    } else {
      const units = join(home, ".config/systemd/user");
      await mkdir(units, { recursive: true });
      await writeFile(join(units, "raphie.service"), "[Unit]\n");
      assert.equal(
        logs().stdout.toString(),
        "journalctl --user -u raphie -n 100 --no-pager\n",
      );
      assert.equal(
        logs("--follow", "--lines", "20").stdout.toString(),
        "journalctl --user -u raphie -n 20 --no-pager -f\n",
      );
    }

    const wrong = logs("--lines", "many");
    assert.notEqual(wrong.exitCode, 0);
    assert.match(
      wrong.stderr.toString(),
      /Usage: raphie logs \[--follow\] \[--lines N\]/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

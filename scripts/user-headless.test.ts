import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("headless setup keeps its key and refuses to switch encrypted data", async () => {
  const temp = await mkdtemp(join(tmpdir(), "raphie-headless-test-"));
  try {
    const source = await readFile(resolve("scripts/install.sh"), "utf8");
    const body = source
      .split("<<'PY_HEADLESS'\n")[1]
      ?.split("\nPY_HEADLESS")[0];
    assert.ok(body);
    const home = join(temp, "home"),
      data = join(home, "data");
    await mkdir(data, { recursive: true });
    const run = () =>
      Bun.spawnSync(
        ["python3", "-c", body, home, join(home, "bin", "raphie"), data],
        { stdout: "pipe", stderr: "pipe" },
      );
    const first = run();
    assert.equal(first.exitCode, 0, first.stderr.toString());
    const key = join(home, ".local/share/raphie-headless/unlock-key");
    const original = await readFile(key);
    assert.equal((await stat(key)).mode & 0o777, 0o600);
    assert.equal(run().exitCode, 0);
    assert.deepEqual(await readFile(key), original);
    const launch = await readFile(
      join(home, ".local/share/raphie-headless/start"),
      "utf8",
    );
    assert.match(launch, /dbus-run-session/);
    assert.equal(
      Bun.spawnSync(["sh", "-n"], { stdin: Buffer.from(launch) }).exitCode,
      0,
    );
    await rm(join(home, ".local/share/raphie-headless"), { recursive: true });
    await rm(join(home, ".config"), { recursive: true });
    const database = join(data, "settings.sqlite");
    const init = Bun.spawnSync([
      "python3",
      "-c",
      "import sqlite3,sys,json; d=sqlite3.connect(sys.argv[1]); d.execute('create table settings(id integer,value text)'); d.execute('insert into settings values(1,?)',(json.dumps({'version':4,'keyId':'existing'}),)); d.commit()",
      database,
    ]);
    assert.equal(init.exitCode, 0);
    const denied = run();
    assert.notEqual(denied.exitCode, 0);
    assert.match(denied.stderr.toString(), /cannot migrate/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

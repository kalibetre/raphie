import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function fixture() {
  const temp = await mkdtemp(join(tmpdir(), "raphie-headless-test-"));
  const source = await readFile(resolve("scripts/install.sh"), "utf8");
  const body = source.split("<<'PY_HEADLESS'\n")[1]?.split("\nPY_HEADLESS")[0];
  assert.ok(body);
  const home = join(temp, 'home with "quotes" $dollar %percent'),
    data = join(home, "data");
  await mkdir(data, { recursive: true });
  const run = () =>
    Bun.spawnSync(["python3", "-c", body, home, data], {
      stdout: "pipe",
      stderr: "pipe",
    });
  return {
    temp,
    home,
    data,
    run,
    privateDir: join(home, ".local/share/raphie-headless"),
    key: join(home, ".local/share/raphie-headless/master-key"),
  };
}

test("headless setup preserves its owner-only key and configures the service without a keyring launcher", async () => {
  const { temp, home, run, privateDir, key } = await fixture();
  try {
    const first = run();
    assert.equal(first.exitCode, 0, first.stderr.toString());
    const original = await readFile(key);
    assert.equal((await stat(key)).mode & 0o777, 0o600);
    assert.equal((await stat(privateDir)).mode & 0o777, 0o700);
    assert.equal(original.length, 45);
    assert.equal(run().exitCode, 0);
    assert.deepEqual(await readFile(key), original);
    const config = await readFile(
      join(home, ".config/systemd/user/raphie.service.d/raphie-headless.conf"),
      "utf8",
    );
    assert.match(
      config,
      /^\[Service\]\nEnvironment="RAPHIE_CREDENTIAL_KEY_FILE=/,
    );
    assert.match(config, /\\"quotes\\" \$dollar %%percent/);
    assert.doesNotMatch(config, /ExecStart|dbus|gnome/);
    await chmod(key, 0o644);
    assert.notEqual(run().exitCode, 0);
    assert.deepEqual(await readFile(key), original);
    await chmod(key, 0o600);
    await chmod(privateDir, 0o755);
    assert.notEqual(run().exitCode, 0);
    await chmod(privateDir, 0o700);
    await rm(key);
    assert.notEqual(run().exitCode, 0);
    await assert.rejects(stat(key), { code: "ENOENT" });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("headless setup refuses existing encrypted data, legacy keyrings, and symlink targets without replacing keys", async () => {
  const { temp, data, run, privateDir, key } = await fixture();
  try {
    const init = Bun.spawnSync([
      "python3",
      "-c",
      "import sqlite3,sys,json; d=sqlite3.connect(sys.argv[1]); d.execute('create table settings(id integer,value text)'); d.execute('insert into settings values(1,?)',(json.dumps({'version':4,'keyId':'existing'}),)); d.commit()",
      join(data, "settings.sqlite"),
    ]);
    assert.equal(init.exitCode, 0);
    const denied = run();
    assert.notEqual(denied.exitCode, 0);
    assert.match(denied.stderr.toString(), /cannot migrate/);
    await assert.rejects(stat(privateDir), { code: "ENOENT" });
    await rm(join(data, "settings.sqlite"));
    await mkdir(privateDir, { recursive: true, mode: 0o700 });
    const legacyKey = join(privateDir, "unlock-key");
    await writeFile(legacyKey, "SYNTHETIC_LEGACY_KEY", { mode: 0o600 });
    await writeFile(join(privateDir, "configured"), "raphie-headless-v1\n");
    assert.notEqual(run().exitCode, 0);
    assert.equal(await readFile(legacyKey, "utf8"), "SYNTHETIC_LEGACY_KEY");
    await assert.rejects(stat(key), { code: "ENOENT" });
    await symlink(legacyKey, key);
    const linked = run();
    assert.notEqual(linked.exitCode, 0);
    assert.match(linked.stderr.toString(), /symbolic link/);
    assert.equal(await readFile(legacyKey, "utf8"), "SYNTHETIC_LEGACY_KEY");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

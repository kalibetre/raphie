import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("binary download verifies provenance before extracting a strict archive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "raphie-release-"));
  const bin = join(dir, "bin");
  const bundle = join(dir, "bundle");
  const out = join(dir, "out");
  await Promise.all([mkdir(bin), mkdir(bundle), mkdir(out)]);
  const names = [
    "raphie",
    "raphie-runtime",
    "raphie-web",
    "install.sh",
    "raphie.service",
    "raphie-admin",
    "keyring-session.sh",
    "update.sh",
    "restore.sh",
    "uninstall.sh",
    "bundle-id.sh",
    "download-release.sh",
  ];
  try {
    await Promise.all(names.map((name) => writeFile(join(bundle, name), name)));
    const archive = join(dir, "bundle.tar.gz");
    assert.equal(
      Bun.spawnSync(["tar", "-czf", archive, "-C", bundle, ...names], {
        env: { ...process.env, COPYFILE_DISABLE: "1" },
      }).exitCode,
      0,
    );
    await writeFile(
      join(dir, "release.json"),
      JSON.stringify({ tag_name: "v1.2.3", draft: false, prerelease: false }),
    );
    await writeFile(
      join(bin, "curl"),
      `#!/bin/sh\ncase "$2" in *api.github.com*) cp "$FIXTURE/release.json" "$4" ;; *) cp "$FIXTURE/bundle.tar.gz" "$4" ;; esac\n`,
      { mode: 0o755 },
    );
    await writeFile(
      join(bin, "gh"),
      '#!/bin/sh\nprintf "%s\\n" "$*" > "$FIXTURE/gh-args"\nexit "${REJECT:-0}"\n',
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FIXTURE: dir,
    };
    const run = (extra: Record<string, string> = {}) =>
      Bun.spawnSync(
        ["sh", "scripts/linux-binary/download-release.sh", out, "v1.2.3"],
        { env: { ...env, ...extra }, stderr: "pipe", stdout: "pipe" },
      );
    assert.notEqual(run({ REJECT: "1" }).exitCode, 0);
    assert.equal((await readdir(out)).length, 0);
    await writeFile(
      join(dir, "release.json"),
      JSON.stringify({ tag_name: "v1.2.4", draft: false, prerelease: false }),
    );
    assert.notEqual(run().exitCode, 0);
    await writeFile(
      join(dir, "release.json"),
      JSON.stringify({ tag_name: "v1.2.3", draft: false, prerelease: false }),
    );
    await writeFile(join(bundle, "unexpected"), "unexpected");
    assert.equal(
      Bun.spawnSync(
        ["tar", "-czf", archive, "-C", bundle, ...names, "unexpected"],
        {
          env: { ...process.env, COPYFILE_DISABLE: "1" },
        },
      ).exitCode,
      0,
    );
    assert.notEqual(run().exitCode, 0);
    assert.equal((await readdir(out)).length, 0);
    assert.equal(
      Bun.spawnSync(["tar", "-czf", archive, "-C", bundle, ...names], {
        env: { ...process.env, COPYFILE_DISABLE: "1" },
      }).exitCode,
      0,
    );
    const success = run();
    assert.equal(success.exitCode, 0, success.stderr.toString());
    assert.equal(await readFile(join(out, "raphie"), "utf8"), "raphie");
    const args = await readFile(join(dir, "gh-args"), "utf8");
    assert.match(args, /--hostname github\.com/);
    assert.match(
      args,
      /--signer-workflow kalibetre\/raphie\/\.github\/workflows\/release\.yml/,
    );
    assert.match(args, /--source-ref refs\/tags\/v1\.2\.3/);
    assert.match(args, /--deny-self-hosted-runners/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

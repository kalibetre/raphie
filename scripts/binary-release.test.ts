import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("binary download supports explicit public alphas and extracts only safe archives without gh", async () => {
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
    "recovery-key.py",
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
    await writeFile(join(bin, "gh"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FIXTURE: dir,
    };
    const run = (version = "v1.2.3") =>
      Bun.spawnSync(
        ["sh", "scripts/linux-binary/download-release.sh", out, version],
        { env, stderr: "pipe", stdout: "pipe" },
      );
    await writeFile(
      join(dir, "release.json"),
      JSON.stringify({
        tag_name: "v1.2.3-alpha.1",
        draft: true,
        prerelease: true,
      }),
    );
    assert.notEqual(run("v1.2.3-alpha.1").exitCode, 0);
    await writeFile(
      join(dir, "release.json"),
      JSON.stringify({
        tag_name: "v1.2.3-alpha.1",
        draft: false,
        prerelease: false,
      }),
    );
    assert.notEqual(run("v1.2.3-alpha.1").exitCode, 0);
    assert.notEqual(run("v1.2.3-alpha.1/../../bad").exitCode, 0);
    await writeFile(
      join(dir, "release.json"),
      JSON.stringify({ tag_name: "v1.2.4", draft: false, prerelease: false }),
    );
    assert.notEqual(run().exitCode, 0);
    await writeFile(
      join(dir, "release.json"),
      JSON.stringify({ tag_name: "v1.2.3", draft: false, prerelease: false }),
    );
    await symlink("raphie", join(bundle, "future-helper"));
    assert.equal(
      Bun.spawnSync(
        ["tar", "-czf", archive, "-C", bundle, ...names, "future-helper"],
        {
          env: { ...process.env, COPYFILE_DISABLE: "1" },
        },
      ).exitCode,
      0,
    );
    assert.notEqual(run().exitCode, 0);
    assert.equal((await readdir(out)).length, 0);
    assert.notEqual(
      Bun.spawnSync(["sh", "scripts/linux-binary/bundle-id.sh", bundle])
        .exitCode,
      0,
    );
    await unlink(join(bundle, "future-helper"));
    await writeFile(join(bundle, "future-helper"), "first version");
    const firstId = Bun.spawnSync([
      "sh",
      "scripts/linux-binary/bundle-id.sh",
      bundle,
    ]);
    assert.equal(firstId.exitCode, 0);
    await writeFile(join(bundle, "future-helper"), "second version");
    const secondId = Bun.spawnSync([
      "sh",
      "scripts/linux-binary/bundle-id.sh",
      bundle,
    ]);
    assert.equal(secondId.exitCode, 0);
    assert.notEqual(firstId.stdout.toString(), secondId.stdout.toString());
    assert.equal(
      Bun.spawnSync(
        ["tar", "-czf", archive, "-C", bundle, ...names, "future-helper"],
        {
          env: { ...process.env, COPYFILE_DISABLE: "1" },
        },
      ).exitCode,
      0,
    );
    await writeFile(
      join(dir, "release.json"),
      JSON.stringify({
        tag_name: "v1.2.3-alpha.1",
        draft: false,
        prerelease: true,
      }),
    );
    assert.notEqual(run("").exitCode, 0);
    const success = run("v1.2.3-alpha.1");
    assert.equal(success.exitCode, 0, success.stderr.toString());
    assert.equal(await readFile(join(out, "raphie"), "utf8"), "raphie");
    assert.equal(
      await readFile(join(out, "future-helper"), "utf8"),
      "second version",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

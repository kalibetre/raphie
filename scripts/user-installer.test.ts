import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("piped user installer selects an alpha, installs without sudo and preserves an existing installation", async () => {
  const temp = await mkdtemp(join(tmpdir(), "raphie-user-install-"));
  const bin = join(temp, "bin");
  const home = join(temp, "home");
  const bundle = join(temp, "bundle");
  try {
    await Promise.all([mkdir(bin), mkdir(home), mkdir(bundle)]);
    for (const name of ["raphie", "raphie-runtime", "raphie-web"])
      await writeFile(join(bundle, name), `fixture-${name}`);
    assert.equal(
      Bun.spawnSync(
        [
          "tar",
          "-czf",
          join(temp, "archive.tar.gz"),
          "-C",
          bundle,
          "raphie",
          "raphie-runtime",
          "raphie-web",
        ],
        { env: { ...process.env, COPYFILE_DISABLE: "1" } },
      ).exitCode,
      0,
    );
    await writeFile(
      join(temp, "release.json"),
      JSON.stringify([
        { tag_name: "v0.0.4-alpha.2", draft: false, prerelease: true },
      ]),
    );
    await writeFile(
      join(bin, "curl"),
      `#!/bin/sh\ncase "$2" in *api.github.com*) cp "$FIXTURE/release.json" "$4";; *) cp "$FIXTURE/archive.tar.gz" "$4";; esac\n`,
    );
    await chmod(join(bin, "curl"), 0o755);
    await writeFile(join(bin, "sudo"), "#!/bin/sh\nexit 99\n");
    await chmod(join(bin, "sudo"), 0o755);
    await writeFile(
      join(bin, "uname"),
      '#!/bin/sh\nif [ "$1" = -s ]; then echo Linux; else echo x86_64; fi\n',
      { mode: 0o755 },
    );
    await writeFile(join(bin, "systemctl"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    const input = await readFile(resolve("scripts/install.sh"));
    const env = {
      ...process.env,
      HOME: home,
      FIXTURE: temp,
      PATH: `${bin}:${process.env.PATH}`,
      USER: "fixture",
      XDG_DATA_HOME: "",
    };
    const run = () =>
      Bun.spawnSync(["bash"], {
        stdin: input,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
    const first = run();
    assert.equal(first.exitCode, 0, first.stderr.toString());
    assert.equal(
      await readFile(join(home, ".local/bin/raphie"), "utf8"),
      "fixture-raphie",
    );
    assert.match(
      await readFile(join(home, ".config/systemd/user/raphie.service"), "utf8"),
      /raphie" start/,
    );
    const macHome = join(temp, "mac home");
    await mkdir(macHome);
    await writeFile(
      join(bin, "uname"),
      '#!/bin/sh\nif [ "$1" = -s ]; then echo Darwin; else echo arm64; fi\n',
      { mode: 0o755 },
    );
    await writeFile(join(bin, "launchctl"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    const mac = Bun.spawnSync(["bash"], {
      stdin: input,
      env: { ...env, HOME: macHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    assert.equal(mac.exitCode, 0, mac.stderr.toString());
    assert.match(
      await readFile(
        join(macHome, "Library/LaunchAgents/com.raphie.user.plist"),
        "utf8",
      ),
      /com\.raphie\.user/,
    );
    const existingHome = join(temp, "existing-home");
    await mkdir(join(existingHome, "Library/Application Support/Raphie"), {
      recursive: true,
    });
    const existing = Bun.spawnSync(["bash"], {
      stdin: input,
      env: { ...env, HOME: existingHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    assert.notEqual(existing.exitCode, 0);
    assert.match(existing.stderr.toString(), /Existing Raphie data/);
    const badHome = join(temp, "bad-home");
    await mkdir(badHome);
    await symlink("raphie", join(bundle, "unsafe-link"));
    assert.equal(
      Bun.spawnSync(
        [
          "tar",
          "-czf",
          join(temp, "archive.tar.gz"),
          "-C",
          bundle,
          "raphie",
          "raphie-runtime",
          "raphie-web",
          "unsafe-link",
        ],
        { env: { ...process.env, COPYFILE_DISABLE: "1" } },
      ).exitCode,
      0,
    );
    const rejected = Bun.spawnSync(["bash"], {
      stdin: input,
      env: { ...env, HOME: badHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    assert.notEqual(rejected.exitCode, 0);
    assert.match(rejected.stderr.toString(), /Invalid release archive/);
    const second = run();
    assert.notEqual(second.exitCode, 0);
    assert.equal(
      await readFile(join(home, ".local/bin/raphie"), "utf8"),
      "fixture-raphie",
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

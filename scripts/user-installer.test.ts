import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
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
      await writeFile(
        join(bundle, name),
        `#!/bin/sh\n# fixture-${name}\nexit 0\n`,
      );
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
        {
          tag_name: "v0.0.4-alpha.2",
          draft: false,
          prerelease: true,
          assets: [
            { name: "raphie-linux-x64.tar.gz" },
            { name: "raphie-darwin-arm64.tar.gz" },
            { name: "SHA256SUMS" },
          ],
        },
      ]),
    );
    const checksum = async () => {
      const digest = createHash("sha256")
        .update(await readFile(join(temp, "archive.tar.gz")))
        .digest("hex");
      await writeFile(
        join(temp, "SHA256SUMS"),
        `${digest}  raphie-linux-x64.tar.gz\n${digest}  raphie-darwin-arm64.tar.gz\n`,
      );
    };
    await checksum();
    await writeFile(
      join(bin, "curl"),
      `#!/bin/sh\ncase "$2" in *api.github.com*) cp "$FIXTURE/release.json" "$4";; *SHA256SUMS) cp "$FIXTURE/SHA256SUMS" "$4";; *) cp "$FIXTURE/archive.tar.gz" "$4";; esac\n`,
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
      "#!/bin/sh\n# fixture-raphie\nexit 0\n",
    );
    assert.match(
      await readFile(join(home, ".config/systemd/user/raphie.service"), "utf8"),
      /raphie" start/,
    );
    const data = join(home, ".local/share/raphie");
    await mkdir(data, { recursive: true });
    await writeFile(join(data, "saved.txt"), "important data");
    const update = run();
    assert.equal(update.exitCode, 0, update.stderr.toString());
    assert.equal(
      await readFile(join(data, "saved.txt"), "utf8"),
      "important data",
    );
    const backups = await readdir(join(home, ".local/share/raphie-backups"));
    assert.equal(backups.length, 1);
    assert.equal(
      await readFile(
        join(
          home,
          ".local/share/raphie-backups",
          backups[0]!,
          "data/saved.txt",
        ),
        "utf8",
      ),
      "important data",
    );
    const macHome = join(temp, "mac home");
    await mkdir(macHome);
    await writeFile(
      join(bin, "uname"),
      '#!/bin/sh\nif [ "$1" = -s ]; then echo Darwin; else echo arm64; fi\n',
      { mode: 0o755 },
    );
    await writeFile(
      join(bin, "launchctl"),
      '#!/bin/sh\necho "$*" >> "$FIXTURE/launchctl.log"\nexit 0\n',
      {
        mode: 0o755,
      },
    );
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
    const noAssetHome = join(temp, "missing-platform-home");
    await mkdir(noAssetHome);
    const originalRelease = await readFile(join(temp, "release.json"));
    await writeFile(
      join(temp, "release.json"),
      JSON.stringify([
        {
          tag_name: "v0.0.4-alpha.2",
          draft: false,
          prerelease: true,
          assets: [{ name: "raphie-linux-x64.tar.gz" }, { name: "SHA256SUMS" }],
        },
      ]),
    );
    const noAsset = Bun.spawnSync(["bash"], {
      stdin: input,
      env: { ...env, HOME: noAssetHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    assert.notEqual(noAsset.exitCode, 0);
    assert.match(noAsset.stderr.toString(), /release with this platform/);
    await writeFile(join(temp, "release.json"), originalRelease);
    const checksumHome = join(temp, "checksum-home");
    await mkdir(checksumHome);
    await writeFile(
      join(temp, "SHA256SUMS"),
      `${"0".repeat(64)}  raphie-darwin-arm64.tar.gz\n`,
    );
    const corrupt = Bun.spawnSync(["bash"], {
      stdin: input,
      env: { ...env, HOME: checksumHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    assert.notEqual(corrupt.exitCode, 0);
    assert.match(corrupt.stderr.toString(), /checksum does not match/);
    assert.equal(existsSync(join(checksumHome, ".local/lib/raphie")), false);
    await checksum();
    const truncatedHome = join(temp, "truncated-home");
    await mkdir(truncatedHome);
    const truncated = Bun.spawnSync(["bash"], {
      stdin: input.subarray(0, Math.floor(input.length / 2)),
      env: { ...env, HOME: truncatedHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    assert.notEqual(truncated.exitCode, 0);
    assert.equal(existsSync(join(truncatedHome, ".local/lib/raphie")), false);
    const failureHome = join(temp, "unhealthy-home");
    await mkdir(failureHome);
    await writeFile(join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await writeFile(join(bundle, "raphie"), "#!/bin/sh\nexit 1\n");
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
    await checksum();
    const unhealthy = Bun.spawnSync(["bash"], {
      stdin: input,
      env: { ...env, HOME: failureHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    assert.notEqual(unhealthy.exitCode, 0);
    assert.match(unhealthy.stderr.toString(), /did not become healthy/);
    assert.match(
      await readFile(join(temp, "launchctl.log"), "utf8"),
      /disable .*com\.raphie\.user/,
    );
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
    await checksum();
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
      "#!/bin/sh\n# fixture-raphie\nexit 0\n",
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 30000);

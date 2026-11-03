import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
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

test("installer persists stable/nightly channels and waits for a safe stable promotion", async () => {
  const temp = await mkdtemp(join(tmpdir(), "raphie-user-install-"));
  const bin = join(temp, "bin"),
    home = join(temp, "home"),
    bundle = join(temp, "bundle");
  try {
    await Promise.all([mkdir(bin), mkdir(home), mkdir(bundle)]);
    for (const name of ["raphie", "raphie-runtime", "raphie-web"])
      await writeFile(
        join(bundle, name),
        `#!/bin/sh\n# fixture-${name}\nexit 0\n`,
      );
    const archive = () =>
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
      );
    assert.equal(archive().exitCode, 0);
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
    const assets = [
      { name: "raphie-linux-x64.tar.gz" },
      { name: "raphie-darwin-arm64.tar.gz" },
      { name: "SHA256SUMS" },
    ];
    const releases = async (
      items: Array<{ tag_name: string; prerelease: boolean; draft?: boolean }>,
    ) =>
      writeFile(
        join(temp, "release.json"),
        JSON.stringify(
          items.map((item) => ({ draft: false, ...item, assets })),
        ),
      );
    const compare = (status: string) =>
      writeFile(join(temp, "compare.json"), JSON.stringify({ status }));
    await compare("ahead");
    await writeFile(
      join(bin, "curl"),
      `#!/bin/sh\ncase "$2" in *api.github.com*/compare/*) cp "$FIXTURE/compare.json" "$4";; *api.github.com*) cp "$FIXTURE/release.json" "$4";; *SHA256SUMS) cp "$FIXTURE/SHA256SUMS" "$4";; *) cp "$FIXTURE/archive.tar.gz" "$4";; esac\n`,
      { mode: 0o755 },
    );
    await writeFile(join(bin, "sudo"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
    await writeFile(
      join(bin, "uname"),
      '#!/bin/sh\nif [ "$1" = -s ]; then echo Linux; else echo x86_64; fi\n',
      { mode: 0o755 },
    );
    await writeFile(join(bin, "systemctl"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    await writeFile(join(bin, "loginctl"), "#!/bin/sh\nexit 0\n", {
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
      SHELL: "/bin/bash",
    };
    const run = (args: string[] = [], override = {}) =>
      Bun.spawnSync(["bash", "-s", "--", ...args], {
        stdin: input,
        env: { ...env, ...override },
        stdout: "pipe",
        stderr: "pipe",
      });
    const marker = join(home, ".local/lib/raphie/.raphie-user-install"),
      channel = join(home, ".local/lib/raphie/.channel");
    await releases([
      { tag_name: "nightly-10-1", prerelease: true },
      { tag_name: "v0.0.4-alpha.3", prerelease: true },
    ]);
    const headlessHome = join(temp, "fresh-headless-home");
    await mkdir(headlessHome);
    const freshHeadless = run(
      ["--headless", "--channel", "nightly", "--no-modify-path"],
      {
        HOME: headlessHome,
      },
    );
    assert.equal(freshHeadless.exitCode, 0, freshHeadless.stderr.toString());
    assert.match(
      freshHeadless.stdout.toString(),
      /Headless credential store configured/,
    );
    assert.equal(
      existsSync(join(headlessHome, ".local/share/raphie-headless/master-key")),
      true,
    );
    assert.equal(
      existsSync(join(headlessHome, ".local/share/raphie-headless/start")),
      false,
    );
    assert.equal(existsSync(join(headlessHome, ".bashrc")), false);
    assert.equal(existsSync(join(headlessHome, ".profile")), false);
    const defaultInstall = run();
    assert.notEqual(defaultInstall.exitCode, 0);
    assert.match(defaultInstall.stdout.toString(), /No stable release/);
    assert.equal(existsSync(marker), false);
    const nightly = run(["--channel", "nightly"]);
    assert.equal(nightly.exitCode, 0, nightly.stderr.toString());
    const bashrc = await readFile(join(home, ".bashrc"), "utf8");
    assert.match(bashrc, /Raphie PATH/);
    assert.match(await readFile(join(home, ".profile"), "utf8"), /Raphie PATH/);
    assert.equal((await readFile(channel, "utf8")).trim(), "nightly");
    assert.equal((await readFile(marker, "utf8")).trim(), "nightly-10-1");
    await releases([
      { tag_name: "nightly-10-1", prerelease: true },
      { tag_name: "v0.0.4-nightly.20261103.20.1", prerelease: true },
      { tag_name: "v0.0.4-nightly.20261103.21.1", prerelease: true },
    ]);
    const upgradedNightly = run();
    assert.equal(
      upgradedNightly.exitCode,
      0,
      upgradedNightly.stderr.toString(),
    );
    assert.equal(
      (await readFile(marker, "utf8")).trim(),
      "v0.0.4-nightly.20261103.21.1",
    );
    await releases([{ tag_name: "nightly-10-1", prerelease: true }]);
    await writeFile(marker, "nightly-10-1\n");
    const sameVersion = run();
    assert.equal(sameVersion.exitCode, 0, sameVersion.stderr.toString());
    assert.match(sameVersion.stdout.toString(), /Already on nightly-10-1/);
    assert.equal(await readFile(join(home, ".bashrc"), "utf8"), bashrc);
    assert.equal(existsSync(join(home, ".local/share/raphie-backups")), false);
    const headless = run(["--headless"]);
    assert.equal(headless.exitCode, 0, headless.stderr.toString());
    assert.match(
      headless.stdout.toString(),
      /Headless credential store configured/,
    );
    assert.equal(
      existsSync(join(home, ".local/share/raphie-headless/master-key")),
      true,
    );

    const headlessKey = await readFile(
      join(home, ".local/share/raphie-headless/master-key"),
    );
    const headlessConfig = await readFile(
      join(home, ".config/systemd/user/raphie.service.d/raphie-headless.conf"),
      "utf8",
    );
    assert.match(headlessConfig, /Environment="RAPHIE_CREDENTIAL_KEY_FILE=/);
    assert.doesNotMatch(headlessConfig, /ExecStart|dbus|gnome/);

    const data = join(home, ".local/share/raphie");
    await mkdir(data, { recursive: true });
    await writeFile(join(data, "saved.txt"), "important data");
    await releases([
      { tag_name: "nightly-11-1", prerelease: true },
      { tag_name: "v0.0.4", prerelease: false },
    ]);
    const update = run();
    assert.equal(update.exitCode, 0, update.stderr.toString());
    assert.equal((await readFile(marker, "utf8")).trim(), "nightly-11-1");
    assert.deepEqual(
      await readFile(join(home, ".local/share/raphie-headless/master-key")),
      headlessKey,
    );
    assert.equal(
      (await readdir(join(home, ".local/share/raphie-backups"))).length,
      1,
    );
    await compare("behind");
    const wait = run(["--channel", "stable"]);
    assert.equal(wait.exitCode, 0, wait.stderr.toString());
    assert.match(wait.stdout.toString(), /No safe stable update/);
    assert.equal((await readFile(channel, "utf8")).trim(), "stable");
    assert.equal((await readFile(marker, "utf8")).trim(), "nightly-11-1");
    assert.equal(
      (await readdir(join(home, ".local/share/raphie-backups"))).length,
      1,
    );
    await rm(join(temp, "compare.json"));
    const unableToVerify = run();
    assert.notEqual(unableToVerify.exitCode, 0);
    assert.match(
      unableToVerify.stderr.toString(),
      /Could not verify update ancestry/,
    );
    assert.equal((await readFile(marker, "utf8")).trim(), "nightly-11-1");
    assert.equal((await readFile(channel, "utf8")).trim(), "stable");
    await compare("ahead");
    const promote = run();
    assert.equal(promote.exitCode, 0, promote.stderr.toString());
    assert.equal((await readFile(marker, "utf8")).trim(), "v0.0.4");
    assert.equal((await readFile(channel, "utf8")).trim(), "stable");
    assert.equal(
      await readFile(join(data, "saved.txt"), "utf8"),
      "important data",
    );
    await releases([{ tag_name: "v0.0.4", prerelease: false }]);
    const switchToNightly = run(["--channel", "nightly"]);
    assert.equal(
      switchToNightly.exitCode,
      0,
      switchToNightly.stderr.toString(),
    );
    assert.equal((await readFile(channel, "utf8")).trim(), "nightly");
    assert.equal((await readFile(marker, "utf8")).trim(), "v0.0.4");
    await releases([
      { tag_name: "nightly-12-1", prerelease: true },
      { tag_name: "v0.0.4", prerelease: false },
    ]);
    const followNightly = run();
    assert.equal(followNightly.exitCode, 0, followNightly.stderr.toString());
    assert.equal((await readFile(marker, "utf8")).trim(), "nightly-12-1");
    await compare("behind");
    const switchBack = run(["--channel", "stable"]);
    assert.equal(switchBack.exitCode, 0, switchBack.stderr.toString());
    assert.equal((await readFile(channel, "utf8")).trim(), "stable");
    assert.equal((await readFile(marker, "utf8")).trim(), "nightly-12-1");
    const rejectedChannel = run(["--channel", "alpha"]);
    assert.notEqual(rejectedChannel.exitCode, 0);
    await releases([
      { tag_name: "v0.0.5-beta.1", prerelease: true },
      { tag_name: "nightly-12-1", prerelease: true },
    ]);
    const noStableUpdate = run();
    assert.equal(noStableUpdate.exitCode, 0);
    assert.equal((await readFile(marker, "utf8")).trim(), "nightly-12-1");
    await releases([{ tag_name: "v0.0.4", prerelease: false }]);
    await compare("ahead");
    const legacyHome = join(temp, "legacy-home");
    const legacyInstall = join(legacyHome, ".local/lib/raphie");
    const legacyBin = join(legacyHome, ".local/bin");
    await mkdir(legacyInstall, { recursive: true });
    await mkdir(legacyBin, { recursive: true });
    await writeFile(
      join(legacyInstall, ".raphie-user-install"),
      "v0.0.4-alpha.3\n",
    );
    await writeFile(
      join(legacyInstall, ".data-directory"),
      join(legacyHome, ".local/share/raphie") + "\n",
    );
    await symlink(join(legacyInstall, "raphie"), join(legacyBin, "raphie"));
    const migrate = run([], { HOME: legacyHome });
    assert.equal(migrate.exitCode, 0, migrate.stderr.toString());
    assert.equal(
      (await readFile(join(legacyInstall, ".channel"), "utf8")).trim(),
      "stable",
    );
    assert.equal(
      (
        await readFile(join(legacyInstall, ".raphie-user-install"), "utf8")
      ).trim(),
      "v0.0.4",
    );
    await releases([{ tag_name: "nightly-12-1", prerelease: true }]);
    const checksumHome = join(temp, "checksum-home");
    await mkdir(checksumHome);
    await writeFile(
      join(temp, "SHA256SUMS"),
      `${"0".repeat(64)}  raphie-linux-x64.tar.gz\n`,
    );
    const corrupt = run(["--channel", "nightly"], { HOME: checksumHome });
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
    assert.equal(archive().exitCode, 0);
    await checksum();
    const unhealthy = run(["--channel", "nightly"], { HOME: failureHome });
    assert.notEqual(unhealthy.exitCode, 0);
    assert.match(unhealthy.stderr.toString(), /did not become healthy/);
    const macHome = join(temp, "mac-home");
    await mkdir(macHome);
    await writeFile(join(bundle, "raphie"), "#!/bin/sh\nexit 0\n");
    assert.equal(archive().exitCode, 0);
    await checksum();
    await writeFile(
      join(bin, "uname"),
      '#!/bin/sh\nif [ "$1" = -s ]; then echo Darwin; else echo arm64; fi\n',
      { mode: 0o755 },
    );
    await writeFile(join(bin, "launchctl"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    const mac = run(["--channel", "nightly"], { HOME: macHome });
    assert.equal(mac.exitCode, 0, mac.stderr.toString());
    assert.match(
      await readFile(
        join(macHome, "Library/LaunchAgents/com.raphie.user.plist"),
        "utf8",
      ),
      /com\.raphie\.user/,
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
    const unsafe = run(["--channel", "nightly"], { HOME: badHome });
    assert.notEqual(unsafe.exitCode, 0);
    assert.match(unsafe.stderr.toString(), /Invalid release archive/);
    assert.equal(existsSync(join(badHome, ".local/lib/raphie")), false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 30000);

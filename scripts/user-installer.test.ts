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

/** Two loopback ports that are free now, as the installer's flags. */
function freePorts() {
  const listeners = [0, 1].map(() =>
    Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }),
  );
  const [runtime, web] = listeners.map((listener) => listener.port);
  for (const listener of listeners) listener.stop(true);
  return {
    runtime: runtime!,
    web: web!,
    flags: ["--port", String(web), "--runtime-port", String(runtime)],
  };
}

/** Whether nothing listens on any of `ports` on loopback. */
function allFree(...ports: number[]) {
  return ports.every((port) => {
    try {
      Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } }).stop(
        true,
      );
      return true;
    } catch {
      return false;
    }
  });
}

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
    // A release is one executable; one from before also has the runtime and
    // web host as executables of their own.
    const single = ["raphie"];
    const separate = ["raphie", "raphie-runtime", "raphie-web"];
    const archive = (names = single) =>
      Bun.spawnSync(
        ["tar", "-czf", join(temp, "archive.tar.gz"), "-C", bundle, ...names],
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
      { name: "raphie-linux-x64.tar.gz", size: 87_654_321 },
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
      `#!/bin/sh\nprintf '%s\\n' "$1" >> "$FIXTURE/curl-flags"\ncase "$2" in *api.github.com*/compare/*) printf '%s' "$2" > "$FIXTURE/compare-url"; cp "$FIXTURE/compare.json" "$4";; *api.github.com*) cp "$FIXTURE/release.json" "$4";; *SHA256SUMS) cp "$FIXTURE/SHA256SUMS" "$4";; *) cp "$FIXTURE/archive.tar.gz" "$4";; esac\n`,
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
      channel = join(home, ".local/lib/raphie/.channel"),
      ports = join(home, ".local/lib/raphie/.ports");
    await releases([
      { tag_name: "nightly-10-1", prerelease: true },
      { tag_name: "v0.0.4-alpha.3", prerelease: true },
    ]);
    const headlessHome = join(temp, "fresh-headless-home");
    await mkdir(headlessHome);
    const freshHeadless = run(
      [
        "--headless",
        "--channel",
        "nightly",
        "--no-modify-path",
        ...freePorts().flags,
      ],
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
    // Fresh installations here take free ports, since this computer may
    // run Raphie on the default ones; the defaults are checked below.
    const main = freePorts();
    const nightly = run(["--channel", "nightly", ...main.flags]);
    assert.equal(nightly.exitCode, 0, nightly.stderr.toString());
    const bashrc = await readFile(join(home, ".bashrc"), "utf8");
    assert.match(bashrc, /Raphie PATH/);
    assert.match(await readFile(join(home, ".profile"), "utf8"), /Raphie PATH/);
    assert.equal((await readFile(channel, "utf8")).trim(), "nightly");
    assert.equal((await readFile(marker, "utf8")).trim(), "nightly-10-1");
    // A new installation saves its ports, and says where to open it.
    const saved = `runtime=${main.runtime}\nweb=${main.web}\n`;
    assert.equal(await readFile(ports, "utf8"), saved);
    assert.match(
      nightly.stdout.toString(),
      new RegExp(`open http://127\\.0\\.0\\.1:${main.web}`),
    );
    // An existing one changes ports with raphie set-port, not the installer.
    const reinstallOnPort = run(["--port", "25020"]);
    assert.notEqual(reinstallOnPort.exitCode, 0);
    assert.match(reinstallOnPort.stderr.toString(), /raphie set-port/);
    assert.equal(await readFile(ports, "utf8"), saved);
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
    // An update keeps the saved ports.
    assert.equal(await readFile(ports, "utf8"), saved);
    // Without flags, a new installation takes the high defaults when they
    // are free, and stops with the rerun command when they are taken (as
    // on a computer already running Raphie).
    const defaultsHome = join(temp, "defaults-home");
    await mkdir(defaultsHome);
    const defaults = run(["--channel", "nightly"], { HOME: defaultsHome });
    if (allFree(24316, 24320)) {
      assert.equal(defaults.exitCode, 0, defaults.stderr.toString());
      assert.equal(
        await readFile(join(defaultsHome, ".local/lib/raphie/.ports"), "utf8"),
        "runtime=24316\nweb=24320\n",
      );
      assert.match(defaults.stdout.toString(), /127\.0\.0\.1:24320/);
    } else {
      assert.notEqual(defaults.exitCode, 0);
      assert.match(
        defaults.stderr.toString(),
        /Port 243(16|20) is in use by another program/,
      );
      assert.equal(existsSync(join(defaultsHome, ".local/lib/raphie")), false);
    }
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
    // Each slow step says what it is doing, the download with its size.
    assert.match(
      update.stdout.toString(),
      /Finding the newest nightly release\.\.\.\n[^]*Checking that nightly-11-1 follows the installed nightly-10-1\.\.\.\nDownloading raphie-linux-x64\.tar\.gz for nightly-11-1 \(87\.7 MB\)\.\.\.\nVerifying the download\.\.\.\nStopping Raphie to update it\.\.\.\n[^]*Waiting for Raphie to start\.\.\./,
    );
    // Without a terminal to draw it on, curl's progress meter stays off.
    assert.deepEqual(
      [
        ...new Set(
          (await readFile(join(temp, "curl-flags"), "utf8")).split("\n"),
        ),
      ],
      ["-fsSL", ""],
    );
    // It asks for a comparison without file diffs, which can be megabytes.
    assert.match(
      await readFile(join(temp, "compare-url"), "utf8"),
      /\/compare\/[^?]+\.\.\.nightly-11-1\?per_page=1&page=2$/,
    );
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
    // A stable release from before the single executable keeps all three.
    const installed = (name: string) =>
      existsSync(join(home, ".local/lib/raphie", name));
    assert.ok(installed("raphie") && !installed("raphie-runtime"));
    assert.equal(archive(separate).exitCode, 0);
    await checksum();
    const promote = run();
    assert.equal(promote.exitCode, 0, promote.stderr.toString());
    assert.equal((await readFile(marker, "utf8")).trim(), "v0.0.4");
    assert.ok(installed("raphie-runtime") && installed("raphie-web"));
    assert.equal(archive().exitCode, 0);
    await checksum();
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
    // Back to a single executable: the separate two go with the old release.
    assert.ok(installed("raphie") && !installed("raphie-runtime"));
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
    // It keeps the ports it had, 4316 and 4320, which a source checkout
    // running on this computer may hold; then it waits for them.
    if (allFree(4316, 4320)) {
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
      assert.equal(
        await readFile(join(legacyInstall, ".ports"), "utf8"),
        "runtime=4316\nweb=4320\n",
      );
    } else {
      assert.notEqual(migrate.exitCode, 0);
      assert.match(migrate.stderr.toString(), /Port 43(16|20) is in use/);
    }
    // Ports can be chosen for a new installation...
    const chosenHome = join(temp, "chosen-home");
    await mkdir(chosenHome);
    const chosen = run(["--port", "25020", "--runtime-port", "25016"], {
      HOME: chosenHome,
    });
    assert.equal(chosen.exitCode, 0, chosen.stderr.toString());
    assert.equal(
      await readFile(join(chosenHome, ".local/lib/raphie/.ports"), "utf8"),
      "runtime=25016\nweb=25020\n",
    );
    assert.match(chosen.stdout.toString(), /127\.0\.0\.1:25020/);
    // ...and a port another program holds stops it before anything is
    // installed, naming the flag to use instead.
    const busy = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    });
    try {
      const takenHome = join(temp, "taken-home");
      await mkdir(takenHome);
      const taken = run(
        [
          "--port",
          String(busy.port),
          "--runtime-port",
          String(freePorts().runtime),
        ],
        { HOME: takenHome },
      );
      assert.notEqual(taken.exitCode, 0);
      assert.match(
        taken.stderr.toString(),
        new RegExp(`Port ${busy.port} is in use by another program`),
      );
      assert.match(taken.stderr.toString(), /bash -s -- --port \d+/);
      assert.equal(existsSync(join(takenHome, ".local/lib/raphie")), false);
      for (const [flags, message] of [
        [["--port", "80"], /1024 to 65535/],
        [["--port", "25020", "--runtime-port", "25020"], /must differ/],
      ] as const) {
        const refused = run([...flags], { HOME: takenHome });
        assert.notEqual(refused.exitCode, 0);
        assert.match(refused.stderr.toString(), message);
      }
    } finally {
      busy.stop(true);
    }
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
    const unhealthy = run(["--channel", "nightly", ...freePorts().flags], {
      HOME: failureHome,
    });
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
    const mac = run(["--channel", "nightly", ...freePorts().flags], {
      HOME: macHome,
    });
    assert.equal(mac.exitCode, 0, mac.stderr.toString());
    assert.match(
      await readFile(
        join(macHome, "Library/LaunchAgents/com.raphie.user.plist"),
        "utf8",
      ),
      /com\.raphie\.user/,
    );
    // The service reads the saved ports at start, so none are written here.
    assert.doesNotMatch(
      await readFile(
        join(macHome, "Library/LaunchAgents/com.raphie.user.plist"),
        "utf8",
      ),
      /PORT|4316|4320/,
    );
    // An update stops the running service. launchctl bootout returns before
    // it has exited, so the update waits for its ports instead of failing.
    const updateHome = join(temp, "update-home");
    const updateInstall = join(updateHome, ".local/lib/raphie");
    await mkdir(updateInstall, { recursive: true });
    await mkdir(join(updateHome, ".local/bin"), { recursive: true });
    await mkdir(join(updateHome, "Library/LaunchAgents"), { recursive: true });
    const held = freePorts();
    await writeFile(
      join(updateInstall, ".raphie-user-install"),
      "nightly-11-1\n",
    );
    await writeFile(join(updateInstall, ".channel"), "nightly\n");
    await writeFile(
      join(updateInstall, ".data-directory"),
      join(updateHome, "Library/Application Support/Raphie") + "\n",
    );
    await writeFile(
      join(updateInstall, ".ports"),
      `runtime=${held.runtime}\nweb=${held.web}\n`,
    );
    await symlink(
      join(updateInstall, "raphie"),
      join(updateHome, ".local/bin/raphie"),
    );
    await writeFile(
      join(updateHome, "Library/LaunchAgents/com.raphie.user.plist"),
      "<plist/>\n",
    );
    // The stopped service keeps the runtime port for two seconds.
    await writeFile(
      join(bin, "launchctl"),
      `#!/bin/sh
case "$1" in
  print) exit 0 ;;
  bootout)
    python3 -c 'import socket, sys, time
s = socket.socket(); s.bind(("127.0.0.1", int(sys.argv[1]))); s.listen()
open(sys.argv[2], "w").close(); time.sleep(2)' "$HOLD_PORT" "$FIXTURE/held" >/dev/null 2>&1 &
    while [ ! -e "$FIXTURE/held" ]; do :; done ;;
  bootstrap) touch "$FIXTURE/bootstrapped" ;;
esac
exit 0
`,
      { mode: 0o755 },
    );
    const macUpdate = run([], {
      HOME: updateHome,
      HOLD_PORT: String(held.runtime),
    });
    assert.equal(macUpdate.exitCode, 0, macUpdate.stderr.toString());
    assert.equal(
      (
        await readFile(join(updateInstall, ".raphie-user-install"), "utf8")
      ).trim(),
      "nightly-12-1",
    );
    assert.ok(existsSync(join(temp, "bootstrapped")));
    await writeFile(join(bin, "launchctl"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    // Intel Macs are not supported, and nothing is installed on one.
    const intelHome = join(temp, "intel-home");
    await mkdir(intelHome);
    await writeFile(
      join(bin, "uname"),
      '#!/bin/sh\nif [ "$1" = -s ]; then echo Darwin; else echo x86_64; fi\n',
      { mode: 0o755 },
    );
    await writeFile(join(bin, "sysctl"), "#!/bin/sh\necho 0\n", {
      mode: 0o755,
    });
    const intel = run(["--channel", "nightly"], { HOME: intelHome });
    assert.notEqual(intel.exitCode, 0);
    assert.match(intel.stderr.toString(), /Apple Silicon Macs only/);
    assert.equal(existsSync(join(intelHome, ".local/lib/raphie")), false);
    await writeFile(
      join(bin, "uname"),
      '#!/bin/sh\nif [ "$1" = -s ]; then echo Darwin; else echo arm64; fi\n',
      { mode: 0o755 },
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
  // Each case runs the whole installer; together they take about 30 s.
}, 90_000);

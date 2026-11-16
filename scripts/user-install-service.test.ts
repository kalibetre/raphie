import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Two loopback ports that were free a moment ago. */
async function freePorts() {
  const listeners = [0, 1].map(() =>
    Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }),
  );
  const ports = listeners.map((listener) => listener.port);
  for (const listener of listeners) listener.stop(true);
  return { runtime: ports[0]!, web: ports[1]! };
}

test("a user installation stops, restarts and updates its background service", async () => {
  const root = await mkdtemp(join(tmpdir(), "raphie-service-user-"));
  try {
    const home = join(root, "home");
    const install = join(home, ".local/lib/raphie");
    const stubs = join(root, "bin");
    await mkdir(install, { recursive: true });
    await mkdir(stubs);
    const binary = join(install, "raphie");
    const build = Bun.spawnSync([
      process.execPath,
      "build",
      "--compile",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      "scripts/raphie.ts",
      "--outfile",
      binary,
    ]);
    assert.equal(build.exitCode, 0, build.stderr.toString());
    await writeFile(join(install, ".raphie-user-install"), "v0.0.5\n");
    const ports = await freePorts();
    await writeFile(
      join(install, ".ports"),
      `runtime=${ports.runtime}\nweb=${ports.web}\n`,
    );
    // launchctl and systemctl: the service runs while $TEST_DIR/running
    // exists, and each action is noted for the test to check.
    const stub = `#!/bin/sh
case "$*" in
  *print*|*is-active*) [ -e "$TEST_DIR/running" ] ;;
  *bootout*|*" stop "*) rm -f "$TEST_DIR/running"; touch "$TEST_DIR/stopped" ;;
  *kickstart*|*restart*) touch "$TEST_DIR/restarted" ;;
  *bootstrap*|*" start "*) touch "$TEST_DIR/running" "$TEST_DIR/started" ;;
esac
`;
    for (const name of ["launchctl", "systemctl"]) {
      await writeFile(join(stubs, name), stub);
      await chmod(join(stubs, name), 0o755);
    }
    // curl hands over an installer that notes its arguments and exits 3.
    await writeFile(
      join(stubs, "curl"),
      `#!/bin/sh
printf '%s' "$2" > "$TEST_DIR/installer-url"
printf '#!/bin/sh\\nprintf "%%s " "$@" > "$TEST_DIR/installer-args"\\nexit 3\\n' > "$4"
`,
    );
    await chmod(join(stubs, "curl"), 0o755);
    const raphie = (args: string[], executable = binary) =>
      Bun.spawn([executable, ...args], {
        env: {
          ...process.env,
          HOME: home,
          PATH: `${stubs}:${process.env.PATH}`,
          TEST_DIR: root,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
    const output = async (child: ReturnType<typeof raphie>) => {
      const [code, out, err] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { code, out, err };
    };
    const noted = (name: string) => existsSync(join(root, name));

    // Without a service set up, restart says what to do instead.
    const none = await output(raphie(["restart"]));
    assert.notEqual(none.code, 0);
    assert.match(none.err, /no background service.*raphie start/);

    // Set up the service the installer would have, running.
    await mkdir(join(home, "Library/LaunchAgents"), { recursive: true });
    await writeFile(
      join(home, "Library/LaunchAgents/com.raphie.user.plist"),
      "<plist/>\n",
    );
    await mkdir(join(home, ".config/systemd/user"), { recursive: true });
    await writeFile(join(home, ".config/systemd/user/raphie.service"), "");
    await writeFile(join(root, "running"), "");

    // Stop stops it, once its ports are free.
    const stopped = await output(raphie(["stop"]));
    assert.equal(stopped.code, 0, stopped.err);
    assert.match(stopped.out, /Raphie stopped/);
    assert.ok(noted("stopped") && !noted("running"));
    assert.match(
      (await output(raphie(["stop"]))).out,
      /background service is not running/,
    );

    // Restart starts a stopped service and waits until Raphie answers on
    // its saved ports; here the test answers as Raphie.
    const runtime = Bun.serve({
      hostname: "127.0.0.1",
      port: ports.runtime,
      fetch: () => Response.json({}),
    });
    const web = Bun.serve({
      hostname: "127.0.0.1",
      port: ports.web,
      fetch: () => Response.json({ status: "ready" }),
    });
    try {
      const started = await output(raphie(["restart"]));
      assert.equal(started.code, 0, started.err);
      assert.match(
        started.out,
        new RegExp(`running at http://127\\.0\\.0\\.1:${ports.web}`),
      );
      assert.ok(noted("started") && !noted("restarted"));
      // A running one is restarted.
      assert.equal((await output(raphie(["restart"]))).code, 0);
      assert.ok(noted("restarted"));
    } finally {
      await runtime.stop(true);
      await web.stop(true);
    }

    // Update runs the installer from main, passing the channel on, and
    // reports its exit status.
    const updated = await output(raphie(["update", "--channel", "nightly"]));
    assert.equal(updated.code, 3);
    assert.equal(
      await readFile(join(root, "installer-url"), "utf8"),
      "https://raw.githubusercontent.com/kalibetre/raphie/main/scripts/install.sh",
    );
    assert.equal(
      (await readFile(join(root, "installer-args"), "utf8")).trim(),
      "--channel nightly",
    );
    await output(raphie(["update"]));
    assert.equal(
      (await readFile(join(root, "installer-args"), "utf8")).trim(),
      "",
    );
    for (const args of [
      ["update", "--channel", "beta"],
      ["update", "--channel"],
      ["update", "now"],
    ]) {
      const refused = await output(raphie(args));
      assert.notEqual(refused.code, 0);
      assert.match(refused.err, /stable or nightly|Usage: raphie update/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("from a source checkout, the service commands say what to use instead", async () => {
  for (const [command, message] of [
    ["stop", /sudo systemctl stop raphie/],
    ["restart", /sudo systemctl restart raphie/],
    ["update", /sudo raphie update/],
  ] as const) {
    const child = Bun.spawnSync(
      [process.execPath, "scripts/raphie.ts", command],
      { stdout: "pipe", stderr: "pipe" },
    );
    assert.notEqual(child.exitCode, 0);
    assert.match(child.stderr.toString(), message);
  }
});

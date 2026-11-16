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

test("a user installation runs on its saved ports, and set-port changes them and restarts the service", async () => {
  const root = await mkdtemp(join(tmpdir(), "raphie-set-port-user-"));
  try {
    const install = join(root, "lib", "raphie");
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
    // The runtime and web host note the addresses they were given.
    for (const name of ["raphie-runtime", "raphie-web"]) {
      await writeFile(
        join(install, name),
        `#!/bin/sh\nprintf "%s %s %s %s" "$PORT" "$RAPHIE_WEB_PORT" "$RAPHIE_RUNTIME_URL" "$RAPHIE_WEB_ORIGIN" > "$TEST_DIR/${name}"\n` +
          // Neither exits before both have noted theirs: start stops the
          // other as soon as one exits.
          'until [ -e "$TEST_DIR/raphie-runtime" ] && [ -e "$TEST_DIR/raphie-web" ]; do sleep 0.05; done\n',
      );
      await chmod(join(install, name), 0o755);
    }
    // launchctl and systemctl: the service is loaded when $SERVICE is on,
    // and a restart is noted for the test to answer.
    const stub =
      '#!/bin/sh\ncase "$*" in *print*|*is-active*) [ "$SERVICE" = on ];; *kickstart*|*restart*) touch "$TEST_DIR/restarted";; esac\n';
    for (const name of ["launchctl", "systemctl"]) {
      await writeFile(join(stubs, name), stub);
      await chmod(join(stubs, name), 0o755);
    }
    // The service files the installer writes, in a home of the test's own.
    const home = join(root, "home");
    await mkdir(join(home, "Library/LaunchAgents"), { recursive: true });
    await writeFile(
      join(home, "Library/LaunchAgents/com.raphie.user.plist"),
      "<plist/>\n",
    );
    await mkdir(join(home, ".config/systemd/user"), { recursive: true });
    await writeFile(join(home, ".config/systemd/user/raphie.service"), "");
    const raphie = (args: string[], service: "on" | "off" = "off") =>
      Bun.spawn([binary, ...args], {
        env: {
          ...process.env,
          HOME: home,
          PATH: `${stubs}:${process.env.PATH}`,
          TEST_DIR: root,
          SERVICE: service,
          // A PORT set for something else never moves Raphie.
          PORT: "3000",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
    const output = async (process: ReturnType<typeof raphie>) => {
      const [code, out, err] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);
      return { code, out, err };
    };

    // An installation from before saved ports keeps the old pair.
    assert.match((await output(raphie(["port"]))).out, /127\.0\.0\.1:4320/);

    // Without a running service, the ports are saved for the next start.
    const first = await freePorts();
    const saved = await output(
      raphie([
        "set-port",
        String(first.web),
        "--runtime",
        String(first.runtime),
      ]),
    );
    assert.equal(saved.code, 0, saved.err);
    assert.match(saved.out, /next time it starts/);
    assert.equal(
      await readFile(join(install, ".ports"), "utf8"),
      `runtime=${first.runtime}\nweb=${first.web}\n`,
    );
    // The stand-ins exit at once, which start reports as a failure.
    await output(raphie(["start"]));
    const given = `${first.runtime} ${first.web} http://127.0.0.1:${first.runtime} http://127.0.0.1:${first.web}`;
    assert.equal(await readFile(join(root, "raphie-runtime"), "utf8"), given);
    assert.equal(await readFile(join(root, "raphie-web"), "utf8"), given);

    // Refused: a busy port, the same port twice, and a privileged one.
    const busy = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    });
    try {
      const refused = await output(raphie(["set-port", String(busy.port)]));
      assert.notEqual(refused.code, 0);
      assert.match(refused.err, new RegExp(`Port ${busy.port} is in use`));
    } finally {
      busy.stop(true);
    }
    const same = await output(
      raphie(["set-port", String(first.web), "--runtime", String(first.web)]),
    );
    assert.match(same.err, /must differ/);
    assert.match(
      (await output(raphie(["set-port", "80"]))).err,
      /1024 to 65535/,
    );

    // With the service running, it restarts on the new ports and is
    // checked: here the test answers as the restarted Raphie.
    const next = await freePorts();
    const change = raphie(
      ["set-port", String(next.web), "--runtime", String(next.runtime)],
      "on",
    );
    while (!existsSync(join(root, "restarted"))) await Bun.sleep(20);
    const runtime = Bun.serve({
      hostname: "127.0.0.1",
      port: next.runtime,
      fetch: () => new Response("runtime"),
    });
    const web = Bun.serve({
      hostname: "127.0.0.1",
      port: next.web,
      fetch: () => Response.json({ status: "locked" }),
    });
    try {
      const restarted = await output(change);
      assert.equal(restarted.code, 0, restarted.err);
      assert.match(
        restarted.out,
        new RegExp(`restarted on http://127\\.0\\.0\\.1:${next.web}`),
      );
      assert.equal(
        await readFile(join(install, ".ports"), "utf8"),
        `runtime=${next.runtime}\nweb=${next.web}\n`,
      );
    } finally {
      await runtime.stop(true);
      await web.stop(true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

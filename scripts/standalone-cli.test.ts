import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

test("standalone launcher stops the other process when one exits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-launcher-test-"));
  try {
    const binary = join(directory, "raphie");
    // Stand-ins for the runtime and web host that raphie runs as its own
    // two processes: the runtime runs until stopped, the web host fails.
    const roles = join(directory, "roles");
    const runtime = join(roles, "packages/runtime/src/main.js");
    const web = join(roles, "apps/web/server.js");
    await mkdir(dirname(runtime), { recursive: true });
    await mkdir(dirname(web), { recursive: true });
    await writeFile(
      runtime,
      `import { writeFileSync } from "node:fs";
const dir = process.env.TEST_DIR;
writeFileSync(\`\${dir}/runtime-dir\`, process.env.DATA_DIRECTORY);
process.on("SIGTERM", () => {
  writeFileSync(\`\${dir}/stopped\`, "stopped");
  process.exit(0);
});
writeFileSync(\`\${dir}/ready\`, "ready");
setInterval(() => {}, 1000);
`,
    );
    await writeFile(
      web,
      `import { existsSync, writeFileSync } from "node:fs";
const dir = process.env.TEST_DIR;
writeFileSync(\`\${dir}/web-dir\`, process.env.DATA_DIRECTORY);
while (!existsSync(\`\${dir}/ready\`)) await Bun.sleep(100);
process.exit(7);
`,
    );
    const build = Bun.spawnSync([
      process.execPath,
      "build",
      "--compile",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      "--define",
      `__RAPHIE_ROLE_ROOT__=${JSON.stringify(pathToFileURL(`${roles}/`).href)}`,
      "scripts/raphie.ts",
      "--outfile",
      binary,
    ]);
    assert.equal(build.exitCode, 0, build.stderr.toString());
    const selected = join(directory, "selected-data");
    const launch = Bun.spawn([binary, "start", "--data-dir", selected], {
      env: {
        ...process.env,
        TEST_DIR: directory,
        DATA_DIRECTORY: join(directory, "ignored"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = setTimeout(() => launch.kill("SIGKILL"), 10_000);
    try {
      assert.equal(await launch.exited, 7);
      assert.equal(
        await readFile(join(directory, "runtime-dir"), "utf8"),
        selected,
      );
      assert.equal(
        await readFile(join(directory, "web-dir"), "utf8"),
        selected,
      );
      assert.equal(
        (await readFile(join(directory, "stopped"), "utf8")).trim(),
        "stopped",
      );
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("raphie --version prints the release it was built as", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-version-test-"));
  try {
    const binary = join(directory, "raphie");
    // As scripts/build-standalone.sh stamps a release.
    const build = Bun.spawnSync([
      process.execPath,
      "build",
      "--compile",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      "--define",
      '__RAPHIE_VERSION__="v0.0.5-nightly.20261116.1.1"',
      "scripts/raphie.ts",
      "--outfile",
      binary,
    ]);
    assert.equal(build.exitCode, 0, build.stderr.toString());
    const release = Bun.spawnSync([binary, "--version"]);
    assert.equal(release.exitCode, 0);
    assert.equal(
      release.stdout.toString(),
      "raphie v0.0.5-nightly.20261116.1.1\n",
    );
    const checkout = Bun.spawnSync([
      process.execPath,
      "scripts/raphie.ts",
      "--version",
    ]);
    assert.equal(checkout.stdout.toString(), "raphie development\n");
    const extra = Bun.spawnSync([binary, "--version", "now"]);
    assert.notEqual(extra.exitCode, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

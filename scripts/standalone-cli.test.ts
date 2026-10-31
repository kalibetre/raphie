import { test } from "bun:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("standalone launcher stops the other process when one exits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-launcher-test-"));
  try {
    const binary = join(directory, "raphie");
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
    const runtime = join(directory, "raphie-runtime");
    const web = join(directory, "raphie-web");
    await writeFile(
      runtime,
      '#!/bin/sh\nprintf "%s" "$DATA_DIRECTORY" > "$TEST_DIR/runtime-dir"\ntrap \'echo stopped > "$TEST_DIR/stopped"; exit 0\' TERM\necho ready > "$TEST_DIR/ready"\nwhile :; do sleep 0.1; done\n',
    );
    await writeFile(
      web,
      '#!/bin/sh\nprintf "%s" "$DATA_DIRECTORY" > "$TEST_DIR/web-dir"\nwhile [ ! -e "$TEST_DIR/ready" ]; do sleep 0.1; done\nexit 7\n',
    );
    await Promise.all([chmod(runtime, 0o755), chmod(web, 0o755)]);
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

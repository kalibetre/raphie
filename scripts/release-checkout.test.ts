import { test } from "bun:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("release checkout accepts a stable tag and rejects unsafe tag names", async () => {
  const dir = await mkdtemp(join(tmpdir(), "raphie-release-test-"));
  try {
    const curl = join(dir, "curl");
    const git = join(dir, "git");
    await writeFile(
      curl,
      '#!/bin/sh\nprintf \'{"tag_name":"%s"}\' "$TEST_TAG"\n',
    );
    await writeFile(
      git,
      '#!/bin/sh\nif [ "$1" = clone ]; then echo clone > "$TEST_MARKER"; else printf "%s\\n" "$TEST_TAG"; fi\n',
    );
    await chmod(curl, 0o755);
    await chmod(git, 0o755);
    const marker = join(dir, "cloned");
    const run = (tag: string) =>
      Bun.spawnSync(
        [
          "sh",
          "scripts/linux-install/release-checkout.sh",
          join(dir, "source"),
        ],
        {
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH}`,
            TEST_TAG: tag,
            TEST_MARKER: marker,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
    const good = run("v1.2.3");
    assert.equal(good.exitCode, 0);
    assert.equal(good.stdout.toString().trim(), "v1.2.3");
    assert.equal((await readFile(marker, "utf8")).trim(), "clone");
    await rm(marker);
    const bad = run("v1.2.3;unsafe");
    assert.notEqual(bad.exitCode, 0);
    await assert.rejects(readFile(marker));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

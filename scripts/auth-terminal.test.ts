import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

test("administrator password is never echoed when input arrives immediately", async () => {
  const temp = await mkdtemp(join(tmpdir(), "raphie-auth-terminal-"));
  try {
    const executable = join(temp, "raphie");
    await writeFile(
      executable,
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve("scripts/raphie.ts"))} "$@"\n`,
      { mode: 0o755 },
    );
    const results = await Promise.all(
      Array.from({ length: 24 }, async (_, index) => {
        const child = Bun.spawn(
          [
            "python3",
            "scripts/standalone-admin.py",
            executable,
            "fixture@example.test",
            "a long scratch password",
          ],
          {
            env: { ...process.env, DATA_DIRECTORY: join(temp, String(index)) },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const [exitCode, error] = await Promise.all([
          child.exited,
          new Response(child.stderr).text(),
        ]);
        return { exitCode, error };
      }),
    );
    assert.deepEqual(
      results.filter((result) => result.exitCode !== 0),
      [],
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 30000);

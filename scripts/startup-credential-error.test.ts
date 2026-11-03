import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("runtime reports an actionable credential-store error without native error details", async () => {
  if (process.platform !== "linux") return;
  const temp = await mkdtemp(join(tmpdir(), "raphie-no-secret-service-"));
  try {
    const result = Bun.spawnSync(
      [process.execPath, resolve("packages/runtime/src/main.ts")],
      {
        env: {
          ...process.env,
          DATA_DIRECTORY: join(temp, "data"),
          DBUS_SESSION_BUS_ADDRESS: `unix:path=${temp}/missing`,
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 10000,
      },
    );
    assert.notEqual(result.exitCode, 0);
    assert.match(
      result.stderr.toString(),
      /Provider credential store unavailable or key missing/,
    );
    assert.doesNotMatch(result.stderr.toString(), /unix:path=/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 15000);

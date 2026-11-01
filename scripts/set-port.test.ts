import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("set-port validates availability, updates local origins and rolls back restart failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "raphie-set-port-"));
  const occupied = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const free = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const newPort = free.port!;
  await free.stop(true);
  try {
    const config = join(dir, "config");
    const lock = join(dir, "lock");
    const failure = join(dir, "failure");
    const original =
      "DATA_DIRECTORY=/var/lib/raphie/data\nRAPHIE_WEB_ORIGIN=http://localhost:4320\nRAPHIE_WEB_PORT=4320\nRAPHIE_WEB_ALLOWED_ORIGINS=https://external.example\n";
    writeFileSync(config, original, { mode: 0o600 });
    for (const [file, contents] of [
      [
        "systemctl",
        '#!/bin/sh\nif [ -f "$TEST_FAILURE" ]; then rm "$TEST_FAILURE"; exit 1; fi\n',
      ],
      ["raphie", "#!/bin/sh\nexit 0\n"],
    ]) {
      writeFileSync(join(dir, file!), contents!);
      chmodSync(join(dir, file!), 0o755);
    }
    const script = readFileSync("scripts/linux-binary/raphie-admin", "utf8")
      .split("<<'RAPHIE_ORIGINS_PY'\n")[1]!
      .split("\nRAPHIE_ORIGINS_PY")[0]!
      .replaceAll("/usr/local/bin/raphie", join(dir, "raphie"));
    const run = (port: string) =>
      Bun.spawnSync(["python3", "-c", script, "set-port", config, lock, port], {
        env: {
          ...process.env,
          PATH: `${dir}:/usr/bin:/bin`,
          TEST_FAILURE: failure,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
    for (const invalid of [
      "0",
      "80",
      "4316",
      "65536",
      "041837",
      String(occupied.port),
    ]) {
      assert.notEqual(run(invalid).exitCode, 0);
      assert.equal(readFileSync(config, "utf8"), original);
    }
    writeFileSync(failure, "fail once");
    assert.notEqual(run(String(newPort)).exitCode, 0);
    assert.equal(readFileSync(config, "utf8"), original);
    assert.equal(run(String(newPort)).exitCode, 0);
    const result = readFileSync(config, "utf8");
    assert.ok(
      result.includes(`RAPHIE_WEB_ORIGIN=http://localhost:${newPort}\n`),
    );
    assert.ok(result.includes(`RAPHIE_WEB_PORT=${newPort}\n`));
    assert.ok(
      result.includes("RAPHIE_WEB_ALLOWED_ORIGINS=https://external.example\n"),
    );
    writeFileSync(
      config,
      original.replace("http://localhost:4320", "https://public.example"),
    );
    assert.equal(run(String(newPort)).exitCode, 0);
    assert.ok(
      readFileSync(config, "utf8").includes(
        "RAPHIE_WEB_ORIGIN=https://public.example\n",
      ),
    );
  } finally {
    await occupied.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

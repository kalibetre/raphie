import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parsePort,
  portEnvironment,
  portFree,
  readUserInstallPorts,
  writeUserInstallPorts,
} from "./user-install-ports.ts";

test("user installation ports are saved, read back and validated", () => {
  const root = mkdtempSync(join(tmpdir(), "raphie-ports-"));
  try {
    const dir = join(root, "raphie");
    mkdirSync(dir);
    // An installation from before saved ports has none.
    assert.equal(readUserInstallPorts(dir), undefined);
    writeUserInstallPorts(dir, { runtime: 25016, web: 25020 });
    assert.equal(
      readFileSync(join(dir, ".ports"), "utf8"),
      "runtime=25016\nweb=25020\n",
    );
    assert.deepEqual(readUserInstallPorts(dir), { runtime: 25016, web: 25020 });
    assert.throws(
      () => writeUserInstallPorts(dir, { runtime: 25020, web: 25020 }),
      /must differ/,
    );
    // Not while the installer is running.
    mkdirSync(join(root, ".raphie-install.lock"));
    assert.throws(
      () => writeUserInstallPorts(dir, { runtime: 25116, web: 25120 }),
      /in progress/,
    );
    rmdirSync(join(root, ".raphie-install.lock"));
    writeFileSync(join(dir, ".ports"), "runtime=80\nweb=25020\n");
    assert.throws(() => readUserInstallPorts(dir), /set-port/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ports are unprivileged numbers, and set every address the services use", async () => {
  assert.equal(parsePort("24320"), 24320);
  for (const bad of [undefined, "", "80", "65536", "24320x", "-1", "2.5"])
    assert.throws(() => parsePort(bad), /1024 to 65535/);
  assert.deepEqual(portEnvironment({ runtime: 24316, web: 24320 }), {
    PORT: "24316",
    RAPHIE_WEB_PORT: "24320",
    RAPHIE_RUNTIME_URL: "http://127.0.0.1:24316",
    RAPHIE_WEB_ORIGIN: "http://127.0.0.1:24320",
  });
  const busy = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  });
  try {
    assert.equal(await portFree(busy.port), false);
  } finally {
    busy.stop(true);
  }
});

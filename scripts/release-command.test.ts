import { test } from "bun:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("release command selects safe versions and pushes only after preflight", async () => {
  const temp = await mkdtemp(join(tmpdir(), "raphie-release-"));
  try {
    const log = join(temp, "calls");
    const git = `#!/bin/sh
case "$*" in
  'rev-parse --show-toplevel') printf '%s\\n' "$FIXTURE";;
  'branch --show-current') echo "\${BRANCH:-main}";;
  'status --porcelain --untracked-files=no') printf '%s' "\${DIRTY:-}";;
  'ls-remote --heads --tags origin') printf 'abc123\\trefs/heads/main\\nabc123\\trefs/tags/v0.0.3\\nabc123\\trefs/tags/v0.0.4-alpha.3\\n';;
  'rev-parse HEAD') echo "\${HEAD_SHA:-abc123}";;
  'show-ref '*) exit 1;;
  'tag -a '*|'push origin '*) printf '%s\\n' "$*" >> "$CALLS";;
  *) exit 1;;
esac
`;
    const gh = `#!/bin/sh
case "$1" in
  repo) echo kalibetre/raphie;;
  api) [ "\${API_FAIL:-0}" = 0 ] || exit 1; printf '%s\\n' v0.0.2 v0.0.3 v0.0.4-alpha.3;;
  *) exit 1;;
esac
`;
    for (const [name, content] of [
      ["git", git],
      ["gh", gh],
    ]) {
      await writeFile(join(temp, name), content);
      await chmod(join(temp, name), 0o755);
    }
    const script = await readFile(resolve("release"));
    const run = (version: string, extra: Record<string, string> = {}) =>
      Bun.spawnSync(["bash", "-s", "--", version], {
        stdin: script,
        env: {
          ...process.env,
          PATH: `${temp}:/usr/bin:/bin`,
          FIXTURE: temp,
          CALLS: log,
          ...extra,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
    for (const [input, expected] of [
      ["patch", "v0.0.4"],
      ["minor", "v0.1.0"],
      ["major", "v1.0.0"],
      ["v2.3.4", "v2.3.4"],
    ]) {
      await writeFile(log, "");
      const result = run(input);
      assert.equal(result.exitCode, 0, result.stderr.toString());
      const calls = await readFile(log, "utf8");
      assert.match(calls, new RegExp(`tag -a ${expected} abc123`));
      assert.match(calls, new RegExp(`push origin refs/tags/${expected}`));
    }
    for (const [input, extra] of [
      ["v0.0.3", {}],
      ["v01.0.0", {}],
      ["patch", { API_FAIL: "1" }],
      ["patch", { HEAD_SHA: "different" }],
      ["patch", { BRANCH: "feature" }],
      ["patch", { DIRTY: " M file" }],
    ] as Array<[string, Record<string, string>]>) {
      await writeFile(log, "");
      assert.notEqual(run(input, extra).exitCode, 0);
      assert.equal(await readFile(log, "utf8"), "");
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

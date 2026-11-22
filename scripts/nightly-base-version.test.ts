import { expect, test } from "bun:test";
import { resolve } from "node:path";

const script = resolve("scripts/nightly-base-version.sh");

function base(tags: string) {
  const run = Bun.spawnSync(["bash", script], { stdin: Buffer.from(tags) });
  return {
    code: run.exitCode,
    out: run.stdout.toString().trim(),
    err: run.stderr.toString().trim(),
  };
}

test("a nightly is named one patch past the newest stable tag", () => {
  expect(base("v0.0.4\nv0.0.5\n").out).toBe("0.0.6");
  // After a minor or a major release it follows that one.
  expect(base("v0.0.5\nv0.1.0\n").out).toBe("0.1.1");
  expect(base("v0.9.9\nv1.0.0\nv0.10.0\n").out).toBe("1.0.1");
});

test("versions are compared as numbers, in any order", () => {
  expect(base("v0.0.10\nv0.0.9\nv0.0.2\n").out).toBe("0.0.11");
  expect(base("v0.10.0\nv0.9.12\n").out).toBe("0.10.1");
});

test("nightlies, alphas and other tags are not stable releases", () => {
  expect(
    base(
      [
        "v0.0.5",
        "v0.0.6-nightly.20261123.45073093612.1",
        "v0.0.7-alpha.1",
        "v1.2",
        "v01.0.0",
        "desktop-v9.9.9",
        "",
      ].join("\n"),
    ).out,
  ).toBe("0.0.6");
});

test("it reads what git ls-remote prints", () => {
  expect(
    base(
      "abc123\trefs/tags/v0.0.4\ndef456\trefs/tags/v0.0.5\n789abc\trefs/tags/v0.0.5-nightly.1.1.1\n",
    ).out,
  ).toBe("0.0.6");
});

test("without a stable tag it fails and says why", () => {
  const none = base("v0.0.1-alpha.1\n");
  expect(none.code).toBe(1);
  expect(none.out).toBe("");
  expect(none.err).toMatch(/No stable/);
});

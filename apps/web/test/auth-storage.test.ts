import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appDataDirectory } from "../../../packages/runtime/src/infrastructure/workspace/app-data.ts";
import { openAuthService } from "../src/infrastructure/auth/auth-service.ts";
import {
  authDirectory,
  authSecret,
  webOrigins,
} from "../src/infrastructure/auth/auth-storage.ts";

test("authentication initializes a data directory that does not exist yet", async () => {
  const root = await mkdtemp(join(tmpdir(), "raphie-auth-new-"));
  try {
    const service = await openAuthService({
      directory: join(root, "data"),
      origins: ["http://127.0.0.1:4320"],
      role: "admin",
    });
    try {
      expect(service.configured()).toBe(false);
      await service.setup("admin@example.test", "a-long-test-password");
      expect(service.configured()).toBe(true);
    } finally {
      service.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the web host keeps authentication beside the runtime's data in every layout", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "raphie-auth-dir-")),
  );
  try {
    execFileSync("git", ["init", "--quiet", root]);
    const checkout = join(root, "checkout");
    await mkdir(checkout);
    await writeFile(
      join(checkout, ".git"),
      `gitdir: ${root}/.git/worktrees/test\n`,
    );
    await mkdir(join(root, ".git/worktrees/test"), { recursive: true });
    await writeFile(join(root, ".git/worktrees/test/commondir"), "../..\n");
    await writeFile(
      join(root, ".git/worktrees/test/HEAD"),
      "ref: refs/heads/test\n",
    );
    for (const configured of [
      undefined,
      "",
      ".data",
      "elsewhere",
      join(root, "abs"),
    ])
      for (const base of [root, checkout])
        expect(authDirectory(base, configured)).toBe(
          appDataDirectory(base, configured),
        );
    await mkdir(join(checkout, ".data"));
    expect(() => authDirectory(checkout)).toThrow("separate data");
    expect(() => appDataDirectory(checkout)).toThrow("separate data");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the signing secret is private, stable, shared by racers and never silently replaced", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-auth-secret-"));
  try {
    // Separate processes, as a starting host and the command line would be.
    const module = new URL(
      "../src/infrastructure/auth/auth-storage.ts",
      import.meta.url,
    ).pathname;
    const secrets = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const child = Bun.spawn(
          [
            "bun",
            "-e",
            `console.log(require(${JSON.stringify(module)}).authSecret(${JSON.stringify(directory)}))`,
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        const [output, code] = await Promise.all([
          new Response(child.stdout).text(),
          child.exited,
        ]);
        expect(code).toBe(0);
        return output.trim();
      }),
    );
    expect(new Set(secrets).size).toBe(1);
    expect(secrets[0]!.length).toBeGreaterThanOrEqual(43);
    expect(authSecret(directory)).toBe(secrets[0]!);
    expect(
      (await Bun.file(join(directory, "auth.secret")).stat()).mode & 0o777,
    ).toBe(0o600);
    expect(new Bun.Glob("*").scanSync(directory).next().value).toBe(
      "auth.secret",
    );

    await chmod(join(directory, "auth.secret"), 0o644);
    expect(() => authSecret(directory)).toThrow("accessible only by its owner");
    await chmod(join(directory, "auth.secret"), 0o600);
    await writeFile(join(directory, "auth.secret"), "short\n");
    expect(() => authSecret(directory)).toThrow("malformed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser origins are exact, with loopback aliases only for loopback", () => {
  expect(webOrigins()).toEqual([
    "http://127.0.0.1:4320",
    "http://localhost:4320",
  ]);
  expect(webOrigins("https://raphie.example.test")).toEqual([
    "https://raphie.example.test",
  ]);
  expect(() => webOrigins("https://raphie.example.test/path")).toThrow();
  expect(() => webOrigins("https://user:pass@raphie.example.test")).toThrow();
});

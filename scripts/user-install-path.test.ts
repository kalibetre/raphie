import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "raphie-shell-path-"));
  const home = join(root, "home with spaces $dollar");
  await mkdir(join(home, ".local/bin"), { recursive: true });
  await writeFile(join(home, ".local/bin/raphie"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  const source = await readFile(resolve("scripts/install.sh"), "utf8");
  const body = source.split("<<'PY_PATH'\n")[1]?.split("\nPY_PATH")[0];
  assert.ok(body);
  return {
    root,
    home,
    configure(shell: string, zdir = home) {
      return Bun.spawnSync(["python3", "-c", body, home, shell, zdir], {
        stdout: "pipe",
        stderr: "pipe",
      });
    },
    shell(args: string[], extra = {}) {
      return Bun.spawnSync(args, {
        env: { HOME: home, PATH: "/usr/bin:/bin", TERM: "dumb", ...extra },
        stdout: "pipe",
        stderr: "pipe",
      });
    },
  };
}

test("Bash PATH setup preserves configuration, works in interactive shells, and never duplicates the block or PATH entry", async () => {
  const f = await fixture();
  try {
    const original = "# existing configuration without a final newline";
    await writeFile(join(f.home, ".bashrc"), original);
    await writeFile(join(f.home, ".bash_profile"), "# custom login profile\n");
    const configured = f.configure("/bin/bash");
    assert.equal(configured.exitCode, 0, configured.stderr.toString());
    const first = await readFile(join(f.home, ".bashrc"), "utf8");
    assert.ok(first.startsWith(original + "\n"));
    assert.match(
      await readFile(join(f.home, ".bash_profile"), "utf8"),
      /Raphie PATH/,
    );
    await assert.rejects(readFile(join(f.home, ".profile")), {
      code: "ENOENT",
    });
    assert.equal(f.configure("/bin/bash").exitCode, 0);
    assert.equal(await readFile(join(f.home, ".bashrc"), "utf8"), first);
    const interactive = f.shell([
      "bash",
      "--noprofile",
      "--rcfile",
      join(f.home, ".bashrc"),
      "-ic",
      "command -v raphie",
    ]);
    assert.equal(interactive.exitCode, 0, interactive.stderr.toString());
    assert.equal(
      interactive.stdout.toString().trim(),
      join(f.home, ".local/bin/raphie"),
    );
    const login = f.shell([
      "bash",
      "--noprofile",
      "--norc",
      "-c",
      '. "$HOME/.bash_profile"; . "$HOME/.bash_profile"; command -v raphie; printf "%s" "$PATH"',
    ]);
    assert.equal(login.exitCode, 0, login.stderr.toString());
    const [command, path] = login.stdout.toString().split("\n");
    assert.equal(command, join(f.home, ".local/bin/raphie"));
    assert.equal(
      path.split(":").filter((entry) => entry === join(f.home, ".local/bin"))
        .length,
      1,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("Bash uses an existing bash_login or creates profile without introducing a shadowing login file", async () => {
  const f = await fixture();
  try {
    assert.equal(f.configure("/bin/bash").exitCode, 0);
    assert.match(
      await readFile(join(f.home, ".profile"), "utf8"),
      /Raphie PATH/,
    );
    await writeFile(
      join(f.home, ".bash_login"),
      "# selected login configuration\n",
    );
    const profile = await readFile(join(f.home, ".profile"), "utf8");
    assert.equal(f.configure("/bin/bash").exitCode, 0);
    assert.match(
      await readFile(join(f.home, ".bash_login"), "utf8"),
      /Raphie PATH/,
    );
    assert.equal(await readFile(join(f.home, ".profile"), "utf8"), profile);
    await assert.rejects(readFile(join(f.home, ".bash_profile")), {
      code: "ENOENT",
    });
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("Zsh PATH setup respects ZDOTDIR for both interactive and login configuration", async () => {
  const f = await fixture();
  try {
    const zdir = join(f.home, ".config/zsh");
    const result = f.configure("/bin/zsh", zdir);
    assert.equal(result.exitCode, 0, result.stderr.toString());
    const initial = await readFile(join(zdir, ".zshrc"), "utf8");
    assert.match(
      await readFile(join(zdir, ".zprofile"), "utf8"),
      /Raphie PATH/,
    );
    assert.equal(f.configure("/bin/zsh", zdir).exitCode, 0);
    assert.equal(await readFile(join(zdir, ".zshrc"), "utf8"), initial);
    const zsh = Bun.which("zsh");
    if (zsh) {
      const shell = f.shell([zsh, "-ic", "command -v raphie"], {
        ZDOTDIR: zdir,
      });
      assert.equal(shell.exitCode, 0, shell.stderr.toString());
      assert.equal(
        shell.stdout.toString().trim(),
        join(f.home, ".local/bin/raphie"),
      );
    }
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("PATH setup preserves external dotfile links and leaves unsupported shell configurations untouched", async () => {
  const f = await fixture();
  try {
    const external = join(f.root, "external-bashrc");
    await writeFile(external, "# external managed config\n");
    await symlink(external, join(f.home, ".bashrc"));
    const result = f.configure("/bin/bash");
    assert.equal(result.exitCode, 0);
    assert.match(result.stderr.toString(), /Could not safely configure/);
    assert.equal(
      await readFile(external, "utf8"),
      "# external managed config\n",
    );
    const files = await readdir(f.home);
    const unsupported = f.configure("/bin/fish");
    assert.equal(unsupported.exitCode, 0);
    assert.match(
      unsupported.stdout.toString(),
      /configure ~\/.local\/bin for your shell/,
    );
    assert.deepEqual(await readdir(f.home), files);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BACKGROUND_CONTEXT as context,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { type ExecutionEnv, getOrThrow } from "@earendil-works/pi-durable/env";
import { registerEnvConformance } from "@earendil-works/pi-durable/testing";

import {
  ContainerCli,
  containerLimits,
} from "../src/domains/workspaces/infrastructure/container-cli.ts";
import { ContainerWorkspace } from "../src/domains/workspaces/infrastructure/container-workspace.ts";

const cli = new ContainerCli();
let available = true;
try {
  cli.run(["version", "--format", "{{.Server.Version}}"]);
  cli.run([
    "image",
    "inspect",
    process.env.RAPHIE_CONTAINER_IMAGE ?? "raphie-workspace:slice2",
  ]);
} catch (error) {
  available = false;
  console.warn(
    `SKIP container acceptance: runtime or fixture image unavailable. Build packages/runtime/test/fixtures/container/Dockerfile. ${String(error)}`,
  );
}
const containerTest = available ? test : test.skip;
const open = (directory: string, workspaceId = "fixture", extra = {}) =>
  ContainerWorkspace.open({
    directory,
    workspaceId,
    idleMinutes: 1,
    diskQuotaMiB: null,
    cli,
    namePrefix: "raphie-test",
    ...extra,
  });

async function fixture(
  check: (provider: ContainerWorkspace, directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "raphie-test-container-"));
  const provider = await open(directory);
  try {
    await check(provider, directory);
  } finally {
    await provider.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function shell(env: ExecutionEnv, command: string | readonly string[]) {
  let output = "";
  const result = getOrThrow(
    await env.exec(
      command,
      {
        onOutput: (text) => {
          output += text;
        },
      },
      context,
    ),
  );
  return { ...result, output };
}

containerTest(
  "real container shares one bot's files across sessions, isolates bots and runs git",
  async () => {
    await fixture(async (a, directory) => {
      const b = await open(join(directory, "b"), "bot-b");
      try {
        const one = a.env();
        const two = a.env();
        expect(one.id).toBe(two.id);
        getOrThrow(await one.writeFile("shared.txt", "hello", context));
        expect(getOrThrow(await two.readTextFile("shared.txt", context))).toBe(
          "hello",
        );
        expect(getOrThrow(await b.env().exists("shared.txt", context))).toBe(
          false,
        );
        expect(
          (
            await shell(
              one,
              'git init repo && cd repo && git config user.email test@example.invalid && git config user.name Fixture && echo hello > file && git add file && git commit -m initial && cd .. && git clone repo clone && test "$(cat clone/file)" = hello && rg hello clone/file',
            )
          ).exitCode,
        ).toBe(0);
        expect(
          (
            await shell(one, [
              "printf",
              "%s",
              "$(touch /workspace/interpolated)",
            ])
          ).output,
        ).toBe("$(touch /workspace/interpolated)");
        expect(getOrThrow(await one.exists("interpolated", context))).toBe(
          false,
        );
      } finally {
        await b.close();
      }
    });
  },
  30_000,
);

containerTest(
  "idle stop and provider restart preserve files and end processes",
  async () => {
    await fixture(async (original, directory) => {
      await original.close();
      let now = 0;
      let provider = await open(directory, "fixture", { now: () => now });
      try {
        await shell(
          provider.env(),
          "echo kept > persisted; sleep 120 >/dev/null 2>&1 &",
        );
        now = 60_001;
        await provider.stopIfIdle();
        expect(
          (await shell(provider.env(), "cat persisted; pgrep -x sleep | wc -l"))
            .output,
        ).toBe("kept\n1\n");
        await provider.close();
        provider = await open(directory);
        expect((await shell(provider.env(), "cat persisted")).output).toBe(
          "kept\n",
        );
      } finally {
        await provider.close();
      }
    });
  },
  30_000,
);

containerTest(
  "timeout, abort and output cap reap even detached descendants and never replay",
  async () => {
    await fixture(async (provider) => {
      const timed = await provider.execute(
        "timeout",
        "setsid sh -c 'sleep 2; echo escaped > /workspace/escaped' & sleep 100",
        { timeout: 0.2 },
        context,
      );
      expect(timed.ok).toBe(false);
      if (!timed.ok) expect(timed.error.code).toBe("timeout");
      expect(
        (
          await provider.execute(
            "timeout",
            "setsid sh -c 'sleep 2; echo escaped > /workspace/escaped' & sleep 100",
            { timeout: 0.2 },
            context,
          )
        ).ok,
      ).toBe(false);
      const controller = new AbortController();
      const aborted = provider
        .env()
        .exec("sleep 100", {}, withAbortSignal(controller.signal, context));
      setTimeout(() => controller.abort(), 200);
      const result = await aborted;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("aborted");
      let bytes = 0;
      const capped = await provider.env().exec(
        "yes x",
        {
          onOutput: (text) => {
            bytes += Buffer.byteLength(text);
          },
        },
        context,
      );
      expect(capped.ok).toBe(false);
      expect(bytes).toBeLessThanOrEqual(containerLimits.outputBytes);
      await new Promise((resolve) => setTimeout(resolve, 2100));
      expect(getOrThrow(await provider.env().exists("escaped", context))).toBe(
        false,
      );
      expect(
        provider.history().filter((row) => row.status === "interrupted").length,
      ).toBe(3);
    });
  },
  30_000,
);

containerTest(
  "replacement fences in-flight and queued file writers before the new owner runs",
  async () => {
    await fixture(async (old, directory) => {
      const running = old
        .env()
        .exec(
          "echo started > started; sleep 10; echo stale > value",
          {},
          context,
        );
      const queued = old.env().writeFile("queued", "bad", context);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const replacement = await open(directory);
      try {
        getOrThrow(
          await replacement.env().writeFile("value", "fresh", context),
        );
        expect((await running).ok).toBe(false);
        expect((await queued).ok).toBe(false);
        expect((await old.env().writeFile("value", "stale", context)).ok).toBe(
          false,
        );
        await old.close();
        expect(
          getOrThrow(await replacement.env().readTextFile("value", context)),
        ).toBe("fresh");
        expect(
          getOrThrow(await replacement.env().exists("queued", context)),
        ).toBe(false);
        expect(
          replacement.history().some((row) => row.status === "interrupted"),
        ).toBe(true);
      } finally {
        await replacement.close();
      }
    });
  },
  30_000,
);

containerTest(
  "symlink targets stay in the container; host parents and control state are inaccessible",
  async () => {
    await fixture(async (provider, directory) => {
      const env = provider.env();
      const hostFile = join(directory, "host-secret");
      await Bun.write(hostFile, "host-only-marker");
      await shell(env, ["ln", "-s", hostFile, "/workspace/host-link"]);
      expect((await env.readTextFile("host-link", context)).ok).toBe(false);
      expect((await env.writeFile("host-link", "changed", context)).ok).toBe(
        false,
      );
      await shell(
        env,
        "ln -s /etc/passwd passwd; ln -s .. parent; ln -s /workspace/../container.sqlite control",
      );
      expect(getOrThrow(await env.readTextFile("passwd", context))).not.toBe(
        await readFile("/etc/passwd", "utf8"),
      );
      expect((await env.writeFile("passwd", "changed", context)).ok).toBe(
        false,
      );
      expect(
        (await env.writeFile("parent/host-secret", "changed", context)).ok,
      ).toBe(false);
      expect((await env.readTextFile("control", context)).ok).toBe(false);
      expect(await readFile(hostFile, "utf8")).toBe("host-only-marker");
    });
  },
  30_000,
);

containerTest(
  "disk quota refuses commands before side effects; no quota is the default",
  async () => {
    await fixture(async (provider, directory) => {
      await shell(
        provider.env(),
        "dd if=/dev/zero of=large bs=1048576 count=2",
      );
      await provider.close();
      const limited = await open(directory, "fixture", { diskQuotaMiB: 1 });
      try {
        const result = await limited.env().exec("touch forbidden", {}, context);
        assert(!result.ok);
        expect(result.error.message).toContain("disk quota exceeded");
        expect(
          getOrThrow(await limited.env().exists("forbidden", context)),
        ).toBe(false);
      } finally {
        await limited.close();
      }
    });
  },
  30_000,
);

if (available)
  registerEnvConformance(
    { describe, it: test, expect },
    "container Pi ExecutionEnv conformance",
    async (check) => {
      await fixture(async (provider) => check(provider.env()));
    },
  );

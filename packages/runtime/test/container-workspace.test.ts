import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BACKGROUND_CONTEXT as context,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { type ExecutionEnv, getOrThrow } from "@earendil-works/pi-durable/env";
import { registerEnvConformance } from "@earendil-works/pi-durable/testing";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import {
  ContainerCli,
  containerLimits,
} from "../src/domains/workspaces/infrastructure/container-cli.ts";
import { createContainerTools } from "../src/domains/workspaces/infrastructure/container-tools.ts";
import { ContainerWorkspace } from "../src/domains/workspaces/infrastructure/container-workspace.ts";
import { chatModel } from "./chat-model.ts";

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
const cleanupScopes = new Map<string, string>();

containerTest(
  "Pi coding tools execute through a bot-bound container with trusted operation ids",
  async () => {
    await fixture(async (provider, directory) => {
      let offered: string[] = [];
      const model = chatModel({
        tool: {
          name: "bash",
          args: { command: "echo native > pi-file; cat pi-file" },
        },
        offeredTools: (names) => {
          if (names.length) offered = names;
        },
      });
      const gateway = await Gateway.open({
        directory: join(directory, "gateway"),
        models: model.models,
        model: { provider: "fixture", modelId: "history" },
      });
      try {
        const tools = createContainerTools(
          async (conversationId, operationId) => {
            expect(
              (await gateway.chats.state()).conversations.some(
                (session) => session.id === conversationId,
              ),
            ).toBe(true);
            return provider.env("/workspace", operationId);
          },
        );
        expect(tools.tools!.every((tool) => tool.replay === "unsafe")).toBe(
          true,
        );
        gateway.install(tools);
        await gateway.sessions.submit(gateway.actors.establish("web"), {
          eventId: "native-tool",
          text: "Create a file",
        });
        for (
          let i = 0;
          i < 300 &&
          (await gateway.chats.state()).turns.some(
            (turn) => turn.status === "pending",
          );
          i++
        )
          await Bun.sleep(20);
        const state = await gateway.chats.state();
        expect(state.turns[0].status).toBe("done");
        expect(state.turns[0].answer).toContain("native");
        expect(offered).toContain("bash");
        expect(offered).not.toContain("workspace_exec");
        expect(
          getOrThrow(await provider.env().readTextFile("pi-file", context)),
        ).toBe("native\n");
        const receipt = provider
          .history()
          .find((entry) => entry.method === "exec")!;
        expect(receipt.id).toStartWith(`${state.conversations[0].id}:`);
        expect(receipt.id).toContain("fixture-call");
      } finally {
        await gateway.close();
      }
    });
  },
  30_000,
);

async function open(directory: string, workspaceId = "fixture", extra = {}) {
  const provider = await ContainerWorkspace.open({
    directory,
    workspaceId,
    idleMinutes: 1,
    diskQuotaMiB: null,
    cli,
    namePrefix: "raphie-test",
    ...extra,
  });
  const db = new Database(join(directory, "workspace", "container.sqlite"), {
    readonly: true,
  });
  try {
    cleanupScopes.set(
      db.query<{ scope: string }, []>("SELECT scope FROM lease").get()!.scope,
      workspaceId,
    );
  } finally {
    db.close();
  }
  return provider;
}

afterAll(() => {
  // Backstop the per-fixture finally blocks, including failed assertions.
  for (const [scope, workspaceId] of cleanupScopes)
    cli.removeOwned(workspaceId, scope);
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
  "stale readers and view cleanup preserve new compute; ephemeral receipts do not accumulate",
  async () => {
    await fixture(async (provider) => {
      const view = provider.env();
      getOrThrow(await view.writeFile("readme", "saved", context));
      const reader = getOrThrow(
        await view.openBinaryReader("readme", undefined, context),
      );
      await view.cleanup(context);
      expect(
        getOrThrow(await provider.env().readTextFile("readme", context)),
      ).toBe("saved");
      await provider.execute(
        "timeout-reader",
        "sleep 100",
        { timeout: 0.1 },
        context,
      );
      expect(
        (
          await shell(
            provider.env(),
            "sleep 120 >/dev/null 2>&1 & echo $! > survivor",
          )
        ).exitCode,
      ).toBe(0);
      await reader.close(context);
      expect((await reader.read(0, 1, context)).ok).toBe(false);
      expect(
        (await shell(provider.env(), "kill -0 $(cat survivor)")).exitCode,
      ).toBe(0);
      expect(
        provider.history().filter((entry) => entry.status === "completed"),
      ).toHaveLength(0);
      expect(
        provider.history().find((entry) => entry.id === "timeout-reader")
          ?.status,
      ).toBe("interrupted");
    });
  },
  30_000,
);

containerTest(
  "throwing watch callbacks cannot close the shared guest transport",
  async () => {
    await fixture(async (provider) => {
      const view = provider.env();
      getOrThrow(await view.writeFile("watched", "before", context));
      let changes = 0;
      const watcher = getOrThrow(
        await view.watch(
          [{ path: "/workspace/watched" }],
          () => {
            changes++;
            throw new Error("broken observer");
          },
          context,
        ),
      );
      try {
        await shell(view, "echo after > watched");
        for (let i = 0; i < 150 && !changes; i++) await Bun.sleep(20);
        expect(changes).toBeGreaterThan(0);
        expect((await view.writeFile("healthy", "yes", context)).ok).toBe(true);
      } finally {
        await watcher.close(context);
      }
    });
  },
  30_000,
);

containerTest(
  "a killed shared guest reconnects before the next file mutation",
  async () => {
    await fixture(async (provider) => {
      const view = provider.env();
      const spawnGuest = cli.exec.bind(cli);
      const guests: ReturnType<ContainerCli["exec"]>[] = [];
      cli.exec = (...args) => {
        const guest = spawnGuest(...args);
        guests.push(guest);
        return guest;
      };
      try {
        getOrThrow(await view.writeFile("kept", "before", context));
        const exited = once(guests[0]!, "exit");
        const killed = await shell(view, [
          "node",
          "-e",
          "const fs=require('node:fs'); for(const pid of fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x))) { if(+pid===process.pid||+pid===process.ppid)continue; try { if(fs.readFileSync('/proc/'+pid+'/cmdline','utf8').startsWith('node\\0--input-type=module\\0'))process.kill(+pid,'SIGKILL'); }catch{} }",
        ]);
        expect(killed.exitCode).toBe(0);
        await exited;
        expect((await view.writeFile("kept", "after", context)).ok).toBe(true);
        expect(getOrThrow(await view.readTextFile("kept", context))).toBe(
          "after",
        );
        expect(
          provider.history().filter((entry) => entry.status === "interrupted"),
        ).toHaveLength(0);
      } finally {
        cli.exec = spawnGuest;
      }
    });
  },
  30_000,
);

containerTest(
  "transient removal failures recover on retry and failed shutdown releases local resources",
  async () => {
    await fixture(async (provider, directory) => {
      await shell(provider.env(), "true");
      const run = cli.run.bind(cli);
      let failRemoval = true;
      cli.run = (args) => {
        if (args[0] === "rm" && failRemoval) {
          failRemoval = false;
          throw new Error("synthetic daemon outage");
        }
        return run(args);
      };
      try {
        const timed = await provider.execute(
          "retry-removal",
          "sleep 100",
          { timeout: 0.1 },
          context,
        );
        expect(timed.ok).toBe(false);
        expect(
          (await provider.env().writeFile("recovered", "yes", context)).ok,
        ).toBe(true);
        failRemoval = true;
        await assert.rejects(provider.close(), /synthetic daemon outage/);
        // close is idempotent even when the first daemon removal failed. Reopen
        // reaps the persisted scope and proves the control store is reusable.
        await provider.close();
        const reopened = await open(directory);
        try {
          expect(
            getOrThrow(await reopened.env().readTextFile("recovered", context)),
          ).toBe("yes");
        } finally {
          await reopened.close();
        }
      } finally {
        cli.run = run;
      }
    });
  },
  30_000,
);

containerTest(
  "init reaps orphaned children before they exhaust the process budget",
  async () => {
    await fixture(async (provider) => {
      expect(
        (
          await shell(
            provider.env(),
            "i=0; while [ $i -lt 200 ]; do sh -c 'sleep 0 &' || exit 1; i=$((i+1)); done; sleep 0.2; true",
          )
        ).exitCode,
      ).toBe(0);
      expect((await shell(provider.env(), ["true"])).exitCode).toBe(0);
    });
  },
  30_000,
);

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

import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";

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
    `SKIP container boundaries: runtime or fixture image unavailable: ${String(error)}`,
  );
}
const containerTest = available ? test : test.skip;
const cleanupScopes = new Map<string, string>();

async function open(directory: string, workspaceId = "boundary-fixture") {
  const provider = await ContainerWorkspace.open({
    directory,
    workspaceId,
    idleMinutes: 1,
    diskQuotaMiB: null,
    namePrefix: "raphie-test",
    cli,
  });
  cleanupScopes.set(scope(directory), workspaceId);
  return provider;
}

afterAll(() => {
  for (const [scopeId, workspaceId] of cleanupScopes)
    cli.removeOwned(workspaceId, scopeId);
});

async function fixture(
  check: (provider: ContainerWorkspace, directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "raphie-test-boundaries-"));
  const provider = await open(directory);
  try {
    await check(provider, directory);
  } finally {
    await provider.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function scope(directory: string) {
  const db = new Database(join(directory, "workspace", "container.sqlite"), {
    readonly: true,
  });
  try {
    return db.query<{ scope: string }, []>("SELECT scope FROM lease").get()!
      .scope;
  } finally {
    db.close();
  }
}

async function exec(
  provider: ContainerWorkspace,
  command: string | readonly string[],
) {
  let output = "";
  const result = getOrThrow(
    await provider.env().exec(
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
  "container hardening and sole host bind are applied by the daemon",
  async () => {
    await fixture(async (provider, directory) => {
      const checked = await exec(
        provider,
        "set -e; id -u; grep -E '^(CapEff|NoNewPrivs):' /proc/self/status; test ! -S /var/run/docker.sock; test ! -e /workspace/container.sqlite; test ! -e /workspace/checkpoint.sqlite; ! touch /etc/raphie-test; printf '%s' \"${RAPHIE_TEST_HOST_SENTINEL-unset}\"",
      );
      expect(checked.exitCode).toBe(0);
      expect(checked.output.split("\n")[0]).not.toBe("0");
      expect(checked.output).toContain("CapEff:\t0000000000000000");
      expect(checked.output).toContain("NoNewPrivs:\t1");
      expect(checked.output).toEndWith("unset");
      const cgroups = await exec(provider, [
        "node",
        "-e",
        "const fs=require('node:fs'); if(fs.existsSync('/sys/fs/cgroup/memory.max')) console.log(JSON.stringify(['memory.max','pids.max','cpu.max'].map(name=>fs.readFileSync('/sys/fs/cgroup/'+name,'utf8').trim())));",
      ]);
      if (cgroups.output.trim())
        expect(JSON.parse(cgroups.output)).toEqual([
          String(containerLimits.memoryBytes),
          String(containerLimits.pids),
          "100000 100000",
        ]);

      const containers = cli.inspect("boundary-fixture", scope(directory));
      expect(containers).toHaveLength(1);
      const actual = JSON.parse(cli.run(["inspect", containers[0]!.Id]))[0];
      expect(actual.HostConfig.ReadonlyRootfs).toBe(true);
      expect(actual.HostConfig.Privileged).toBe(false);
      expect(actual.HostConfig.CapDrop).toContain("ALL");
      expect(actual.HostConfig.SecurityOpt).toContain("no-new-privileges");
      expect(actual.HostConfig.Memory).toBe(containerLimits.memoryBytes);
      expect(actual.HostConfig.NanoCpus).toBe(containerLimits.cpus * 1e9);
      expect(actual.HostConfig.PidsLimit).toBe(containerLimits.pids);
      expect(actual.HostConfig.PortBindings).toEqual({});
      expect(actual.HostConfig.NetworkMode).toBe("bridge");
      expect(
        actual.Mounts.filter(
          (mount: { Type: string }) => mount.Type === "bind",
        ),
      ).toEqual([
        expect.objectContaining({
          Source: join(directory, "workspace", "files"),
          Destination: "/workspace",
          RW: true,
        }),
      ]);
      expect(
        actual.Mounts.filter(
          (mount: { Type: string }) => mount.Type !== "tmpfs",
        ),
      ).toHaveLength(1);
      expect(
        actual.Config.Env.some((entry: string) =>
          entry.startsWith("RAPHIE_TEST_HOST_SENTINEL="),
        ),
      ).toBe(false);
    });
  },
  30_000,
);

containerTest(
  "real process crash leaves interrupted intent, reaps stale container and never replays",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "raphie-test-crash-"));
    let provider: ContainerWorkspace | undefined;
    const child = fork(
      join(import.meta.dir, "container-crash-worker.ts"),
      [directory],
      {
        execPath: process.execPath,
        env: {
          ...process.env,
          RAPHIE_TEST_HOST_SENTINEL: "synthetic-host-only",
        },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Crash fixture did not start: ${stderr}`)),
          10_000,
        );
        child.once("message", () => {
          clearTimeout(timer);
          resolve();
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error(`Crash fixture exited: ${stderr}`));
        });
      });
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill("SIGKILL");
      await exited;
      provider = await open(directory, "crash-fixture");
      expect(
        provider.history().find((row) => row.id === "crashed-command")?.status,
      ).toBe("interrupted");
      const retried = await provider.execute(
        "crashed-command",
        "echo once >> count; echo began; sleep 100; echo late > late",
        {},
        context,
      );
      assert(!retried.ok);
      expect(retried.error.message).toContain("will not be replayed");
      expect((await exec(provider, "cat count; test ! -e late")).output).toBe(
        "once\n",
      );
      expect(cli.inspect("crash-fixture", scope(directory))).toHaveLength(1);
    } finally {
      child.kill("SIGKILL");
      if (!provider) provider = await open(directory, "crash-fixture");
      await provider.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);

containerTest(
  "container loss interrupts intent and the next command transparently starts new compute",
  async () => {
    await fixture(async (provider, directory) => {
      await exec(provider, "echo durable > saved");
      const running = provider.execute(
        "lost",
        "sleep 100; echo wrong > saved",
        {},
        context,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      cli.removeOwned("boundary-fixture", scope(directory));
      expect((await running).ok).toBe(false);
      expect(provider.history().find((row) => row.id === "lost")?.status).toBe(
        "interrupted",
      );
      expect((await exec(provider, "cat saved")).output).toBe("durable\n");
    });
  },
  30_000,
);

containerTest(
  "per-bot ordering, runtime command capacity and running-container capacity are independent",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "raphie-test-capacity-"));
    const providers: ContainerWorkspace[] = [];
    try {
      for (let index = 0; index < containerLimits.containers + 1; index++)
        providers.push(
          await open(join(directory, String(index)), `capacity-${index}`),
        );
      const running = providers
        .slice(0, containerLimits.concurrent)
        .map((provider) => provider.env().exec("sleep 1", {}, context));
      await new Promise((resolve) => setTimeout(resolve, 100));
      const busy = await providers
        .at(-1)!
        .env()
        .exec("touch should-not-run", {}, context);
      assert(!busy.ok);
      expect(busy.error.message).toContain("command capacity");
      expect((await Promise.all(running)).every((result) => result.ok)).toBe(
        true,
      );
      const full = await providers.at(-1)!.env().exec("true", {}, context);
      assert(!full.ok);
      expect(full.error.message).toContain("Container capacity");
      const provider = providers[0]!;
      const writes = Array.from(
        { length: containerLimits.queued },
        (_, index) =>
          provider
            .env()
            .exec(
              `${index === 0 ? "sleep 0.2; " : ""}echo ${index} >> ordered`,
              {},
              context,
            ),
      );
      const overflow = await provider
        .env()
        .exec("echo overflow >> ordered", {}, context);
      assert(!overflow.ok);
      expect(overflow.error.message).toContain("queue is full");
      expect((await Promise.all(writes)).every((result) => result.ok)).toBe(
        true,
      );
      expect((await exec(provider, "cat ordered")).output).toBe(
        Array.from(
          { length: containerLimits.queued },
          (_, index) => `${index}\n`,
        ).join(""),
      );
    } finally {
      for (const provider of providers) await provider.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);

containerTest(
  "network probe records actual host/LAN reachability rather than claiming egress denial",
  async () => {
    const loopback = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("raphie-network-fixture"),
    });
    const lan = Bun.serve({
      hostname: "0.0.0.0",
      port: 0,
      fetch: () => new Response("raphie-network-fixture"),
    });
    try {
      await fixture(async (provider, directory) => {
        await exec(provider, "true");
        const owned = cli.inspect("boundary-fixture", scope(directory));
        const inspected = JSON.parse(cli.run(["inspect", owned[0]!.Id]))[0];
        const gateway = inspected.NetworkSettings.Networks.bridge
          .Gateway as string;
        const hostAddresses = Object.values(networkInterfaces())
          .flat()
          .filter(
            (entry) => entry && !entry.internal && entry.family === "IPv4",
          )
          .map((entry) => entry!.address);
        const targets = [
          ["container-loopback-to-host-port", "127.0.0.1", loopback.port],
          [
            "host.docker.internal-loopback",
            "host.docker.internal",
            loopback.port,
          ],
          ["host.docker.internal-wildcard", "host.docker.internal", lan.port],
          ["host-gateway", gateway, lan.port],
          ...hostAddresses.map((address) => [
            "host-interface",
            address,
            lan.port,
          ]),
          ["private-10", "10.0.0.1", 80],
          ["private-172", "172.16.0.1", 80],
          ["private-192", "192.168.0.1", 80],
          ["metadata", "169.254.169.254", 80],
          ["ipv6-loopback", "::1", loopback.port],
          ["ipv6-ula", "fd00::1", 80],
          ["public-internet", "example.com", 80],
        ];
        const source = `const net = require('node:net'); const targets = ${JSON.stringify(targets)};
        Promise.all(targets.map(([name,host,port]) => new Promise(resolve => {
          const socket = net.connect({host,port}); let done=false;
          const finish = result => { if(done)return;done=true; socket.destroy();resolve({name,host,port,result}); };
          socket.setTimeout(1200,()=>finish('timeout (not proof of denial)'));
          socket.once('connect',()=>finish('reachable')); socket.once('error',error=>finish(error.code));
        }))).then(results=>console.log(JSON.stringify(results)));`;
        const probe = await exec(provider, ["node", "-e", source]);
        expect(probe.exitCode).toBe(0);
        const results = JSON.parse(probe.output) as {
          name: string;
          result: string;
        }[];
        expect(
          results.find(
            (result) => result.name === "container-loopback-to-host-port",
          )!.result,
        ).not.toBe("reachable");
        console.log("RAPHIE_NETWORK_PROBE", probe.output.trim());
      });
    } finally {
      await loopback.stop(true);
      await lan.stop(true);
    }
  },
  30_000,
);

containerTest(
  "completed receipts survive restart and a full journal stops new writes without evicting receipts",
  async () => {
    await fixture(async (provider, directory) => {
      const command = "echo once >> receipt-file; printf saved-output";
      expect((await provider.execute("receipt", command, {}, context)).ok).toBe(
        true,
      );
      await provider.close();
      const reopened = await open(directory);
      try {
        let savedOutput = "";
        expect(
          (
            await reopened.execute(
              "receipt",
              command,
              {
                onOutput: (text) => {
                  savedOutput += text;
                },
              },
              context,
            )
          ).ok,
        ).toBe(true);
        expect(savedOutput).toBe("saved-output");
        expect((await exec(reopened, "cat receipt-file")).output).toBe(
          "once\n",
        );
        expect(
          (
            await reopened.execute(
              "receipt",
              "echo conflict >> receipt-file",
              {},
              context,
            )
          ).ok,
        ).toBe(false);
        const db = new Database(
          join(directory, "workspace", "container.sqlite"),
        );
        try {
          db.query(
            `WITH RECURSIVE entries(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM entries WHERE n<?)
          INSERT INTO commands SELECT 'capacity-' || n, 1, 'exec', 'interrupted', 'fixture', NULL FROM entries`,
          ).run(containerLimits.journalEntries);
        } finally {
          db.close();
        }
        const full = await reopened.env().exec("touch forbidden", {}, context);
        assert(!full.ok);
        expect(full.error.message).toContain("journal is full");
        expect(
          (await reopened.execute("receipt", command, {}, context)).ok,
        ).toBe(true);
        expect(
          getOrThrow(await reopened.env().exists("forbidden", context)),
        ).toBe(false);
        const oversized = await reopened
          .env()
          .exec("x".repeat(containerLimits.sourceBytes + 1), {}, context);
        assert(!oversized.ok);
        expect(oversized.error.message).toContain("source limit");
      } finally {
        await reopened.close();
      }
    });
  },
  30_000,
);

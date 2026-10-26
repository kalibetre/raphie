import { expect, test } from "bun:test";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { defineTask } from "@earendil-works/pi-durable";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { watchJobRun } from "../src/domains/conversations/infrastructure/pi-conversation-service.ts";
import { BotJobs } from "../src/domains/schedules/infrastructure/bot-jobs.ts";
import { JobRuns } from "../src/domains/schedules/infrastructure/job-runs.ts";
import { jobRoutes } from "../src/domains/schedules/presentation/http/routes.ts";
import { chatModel } from "./chat-model.ts";

async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 500; i++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("Run did not settle");
}

function jobsFor(gateway: Gateway) {
  const actor = gateway.actors.establish("web");
  const jobs = BotJobs.open({
    root: gateway.root,
    harness: gateway.harness,
    install: (extension) => gateway.install(extension),
    busy: async () => false,
    submit: (input) => gateway.sessions.submitScheduled(actor, input),
  });
  gateway.harness.resume();
  return jobs;
}

for (const fail of [false, true]) {
  test(`job tracks actual ${fail ? "failure" : "completion"}, stable notifications and history after removal`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "raphie-run-"));
    const release = Promise.withResolvers<void>();
    let gateway = await Gateway.open({
      directory,
      deferResume: true,
      ...chatModel({ pause: release.promise, fail }),
    });
    let jobs = jobsFor(gateway);
    try {
      const [job] = await jobs.add({
        name: "Brief",
        prompt: "Write a brief",
        everyMinutes: null,
        firstRunAt: Date.now(),
      });
      await until(
        async () => (await jobs.runs()).items[0]?.status === "running",
      );
      const running = (await jobs.runs()).items[0];
      expect(running.turnId).toBeTruthy();
      expect(running.sessionId).toBeTruthy();
      expect(running.finishedAt).toBeNull();
      expect((await jobs.runs({ unread: true })).items).toEqual([]);
      release.resolve();
      await until(
        async () => (await jobs.runs()).items[0]?.finishedAt !== null,
      );
      const finished = (await jobs.runs()).items[0];
      expect(finished.status).toBe(fail ? "failed" : "completed");
      expect((await jobs.read())[0].lastRun?.id).toBe(running.id);
      expect(
        (await jobs.runs({ unread: true })).items.map((r) => r.id),
      ).toEqual([running.id]);
      await jobs.change(job.id, "remove");
      expect((await jobs.runs()).items).toHaveLength(1);
      await gateway.close();
      gateway = await Gateway.open({
        directory,
        deferResume: true,
        ...chatModel(),
      });
      jobs = jobsFor(gateway);
      expect(
        (await jobs.runs({ unread: true })).items.map((r) => r.id),
      ).toEqual([running.id]);
      await jobs.acknowledge(running.id);
      const acknowledged = (await jobs.runs()).items[0].acknowledgedAt;
      await jobs.acknowledge(running.id);
      expect((await jobs.runs()).items[0].acknowledgedAt).toBe(acknowledged);
      expect((await jobs.runs({ unread: true })).items).toEqual([]);
      expect((await jobs.runs()).items[0].finishedAt).toBe(finished.finishedAt);
      await gateway.close();
      gateway = await Gateway.open({
        directory,
        deferResume: true,
        ...chatModel(),
      });
      jobs = jobsFor(gateway);
      expect((await jobs.runs({ unread: true })).items).toEqual([]);
    } finally {
      release.resolve();
      await gateway.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("admission failure has a terminal run without inventing a conversation; bot histories and read receipts are isolated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-run-failed-"));
  const a = await Gateway.open({
    directory: join(directory, "a"),
    deferResume: true,
  });
  const b = await Gateway.open({
    directory: join(directory, "b"),
    deferResume: true,
  });
  const jobs = jobsFor(a),
    other = jobsFor(b);
  try {
    const [job] = await jobs.add({
      name: "No model",
      prompt: "Cannot run",
      everyMinutes: null,
      firstRunAt: Date.now(),
    });
    await until(async () => (await jobs.runs()).items[0]?.status === "failed");
    const run = (await jobs.runs()).items[0];
    expect(run.turnId).toBeNull();
    expect(run.sessionId).toBeNull();
    expect(run.jobId).toBe(job.id);
    expect((await other.runs()).items).toEqual([]);
    const router = jobRoutes(jobs),
      otherRouter = jobRoutes(other);
    expect((await (await router.request("/runs")).json()).items).toHaveLength(
      1,
    );
    expect(
      (await (await router.request("/notifications")).json()).items,
    ).toHaveLength(1);
    otherRouter.onError((_error, c) => c.json({ error: "Not found" }, 404));
    expect(
      (
        await otherRouter.request(`/runs/${encodeURIComponent(run.id)}/read`, {
          method: "POST",
        })
      ).status,
    ).toBe(404);
    expect((await jobs.runs({ unread: true })).items).toHaveLength(1);
    expect(
      (
        await router.request(`/runs/${encodeURIComponent(run.id)}/read`, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(
      (await (await router.request("/notifications")).json()).items,
    ).toHaveLength(0);
  } finally {
    await a.close();
    await b.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("run watcher records interrupted and faulted tasks without replaying effects", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-run-outcome-"));
  const gateway = await Gateway.open({ directory, deferResume: true });
  const jobs = jobsFor(gateway);
  try {
    for (const outcome of ["aborted", "faulted"] as const) {
      const reply = defineTask<null, { phase: "work" }, null>({
        name: `fixture.run-${outcome}`,
        version: 1,
        initial: () => ({ phase: "work" }),
        abort: (_task, runtime, ctx) =>
          runtime.commit(
            () => ({ status: "terminal", outcome: { status: "aborted" } }),
            ctx,
          ),
        phases: {
          work: async (_task, runtime, ctx) => {
            if (outcome === "faulted")
              throw new Error("synthetic private error");
            await runtime.commit(
              () => ({ status: "terminal", outcome: { status: "aborted" } }),
              ctx,
            );
          },
        },
      });
      gateway.install({ name: `fixture.${outcome}`, tasks: [reply] });
      await gateway.root.commit(async (tx) => {
        const taskId = await tx.createTask(reply, null, {
          ownership: { kind: "conversation" },
        });
        (await tx.doc(JobRuns)).items.push({
          id: outcome,
          jobId: "job",
          name: "Interrupted",
          scheduledFor: 0,
          startedAt: 1,
          finishedAt: null,
          status: "running",
          sessionId: null,
          turnId: outcome,
          acknowledgedAt: null,
        });
        await tx.createTask(
          watchJobRun,
          { turnId: outcome, taskId },
          { ownership: { kind: "conversation" }, background: true },
        );
      }, context);
      gateway.harness.resume();
      await until(
        async () =>
          (await jobs.runs()).items.find((r) => r.id === outcome)
            ?.finishedAt !== null,
      );
      const run = (await jobs.runs()).items.find((r) => r.id === outcome)!;
      expect(run.status).toBe(outcome === "aborted" ? "interrupted" : "failed");
      expect(JSON.stringify(run)).not.toContain("private error");
    }
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const phase of ["queued", "admitted"]) {
  test(`SIGKILL with a ${phase} run recovers one turn and one notification`, async () => {
    const { spawn } = await import("node:child_process");
    const directory = await mkdtemp(join(tmpdir(), "raphie-job-crash-"));
    const child = spawn(
      process.execPath,
      [
        new URL("./job-run-crash-worker.ts", import.meta.url).pathname,
        directory,
        phase,
      ],
      { stdio: ["ignore", "pipe", "pipe"], env: {} },
    );
    let gateway: Gateway | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Run crash fixture timed out")),
          5000,
        );
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk;
          if (output.includes("run-checkpoint-committed")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("Run crash fixture exited early"));
        });
      });
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      gateway = await Gateway.open({
        directory,
        deferResume: true,
        ...chatModel(),
      });
      const jobs = jobsFor(gateway);
      await until(
        async () => (await jobs.runs()).items[0]?.status === "completed",
      );
      await until(
        async () => (await jobs.read())[0]?.lastStatus === "submitted",
      );
      expect((await gateway.chats.state()).turns).toHaveLength(1);
      expect((await jobs.runs()).items).toHaveLength(1);
      const [notice] = (await jobs.runs({ unread: true })).items;
      expect(notice.turnId).toBe((await gateway.chats.state()).turns[0].id);
      await jobs.acknowledge(notice.id);
      gateway.harness.resume();
      await delay(30);
      expect((await jobs.runs({ unread: true })).items).toEqual([]);
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await gateway?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);
}

import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";

export async function eventually(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail("Expected state was not reached within 3 seconds.");
}

test("pending workflow survives reopen; competing clients produce one file effect", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-gateway-"));
  let app = await Gateway.open({ directory, discordThreadId: "discord:test" });
  try {
    const bytes = Buffer.from([0, 255, 128, 10]);
    const file = await app.files.put("manager-notes.bin", bytes);
    const input = {
      source: "discord" as const,
      eventId: "message-1",
      actor: "owner",
      text: "Keep this",
      files: [file],
      discordThreadId: "discord:guild:channel:thread",
    };
    const id = await app.accept(input);
    assert.equal(await app.accept(input), id);
    await assert.rejects(
      app.accept({ ...input, text: "Different action" }),
      /different content/,
    );
    await app.close();
    app = await Gateway.open({ directory, discordThreadId: "discord:test" });
    assert.equal((await app.state()).approvals[0].status, "pending");
    await assert.rejects(
      app.decide(id, "approved", "stranger", "discord"),
      /authorized/,
    );
    const decisions = await Promise.all([
      app.decide(id, "approved", "owner", "web"),
      app.decide(id, "rejected", "owner", "discord"),
      app.decide(id, "approved", "owner", "web"),
    ]);
    assert.deepEqual(decisions, ["approved", "approved", "approved"]);
    await eventually(
      async () => (await app.state()).approvals[0].effectCount === 1,
    );
    const state = await app.state();
    assert.equal(state.approvals.length, 1);
    assert.deepEqual(
      await app.files.read(state.approvals[0].results[0].id),
      bytes,
    );
    assert.equal(state.deliveries.filter((d) => d.kind === "result").length, 1);
    assert.equal(
      state.deliveries.every((d) => d.threadId === input.discordThreadId),
      true,
    );
    const delivery = await app.claimDelivery();
    assert.ok(delivery);
    await app.close();
    app = await Gateway.open({ directory, discordThreadId: "discord:test" });
    assert.equal((await app.state()).deliveries[0].status, "uncertain");
    assert.equal((await app.state()).approvals[0].effectCount, 1);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejection and expiry never execute the effect", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-expiry-"));
  const app = await Gateway.open({ directory, approvalTtlMs: 80 });
  try {
    const input = {
      source: "web" as const,
      actor: "owner",
      text: "Do not deliver",
      files: [],
    };
    const rejected = await app.accept({ ...input, eventId: "rejected" });
    await app.decide(rejected, "rejected", "owner", "web");
    const expired = await app.accept({ ...input, eventId: "expired" });
    await eventually(
      async () =>
        (await app.state()).approvals.find((a) => a.id === expired)?.status ===
        "expired",
    );
    assert.equal(
      await app.decide(expired, "approved", "owner", "discord"),
      "expired",
    );
    assert.equal(
      (await app.state()).approvals.every((a) => a.effectCount === 0),
      true,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

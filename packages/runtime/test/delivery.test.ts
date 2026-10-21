import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { Chats } from "../src/domains/conversations/infrastructure/pi-conversation-service.ts";
import { createDeliveryWorker } from "../src/domains/delivery/application/worker.ts";
import { DeliveryPlans } from "../src/domains/delivery/infrastructure/pi-delivery-queue.ts";
import { discordRenderer } from "../src/infrastructure/discord/delivery.ts";

for (const acknowledged of [true, false])
  test(`multipart delivery recovers after SIGKILL with first chunk ${acknowledged ? "confirmed" : "uncertain"}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "raphie-delivery-"));
    let app = await Gateway.open({ directory });
    try {
      await app.root.commit(async (tx) => {
        (await tx.doc(Chats)).deliveries.push({
          id: "original-id",
          turnId: "turn",
          threadId: "discord:guild:channel",
          text: "x".repeat(4500),
          status: "pending",
        });
      }, context);
      await app.close();
      const child = Bun.spawn(
        [
          process.execPath,
          new URL("./delivery-worker.ts", import.meta.url).pathname,
          directory,
          String(acknowledged),
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      try {
        const reader = child.stdout.getReader();
        const ready = await reader.read();
        assert.equal(
          new TextDecoder().decode(ready.value).trim(),
          "first-chunk",
        );
        child.kill("SIGKILL");
        await child.exited;
        reader.releaseLock();
      } finally {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
          await child.exited;
        }
      }
      app = await Gateway.open({ directory });
      const sent: string[] = [];
      await createDeliveryWorker(
        app.deliveries,
        discordRenderer(app.files),
        async (payload) => {
          sent.push(payload);
          return `remaining-${sent.length}`;
        },
      )();
      const plan = (await app.harness.snapshot(DeliveryPlans, context))!
        .plans[0];
      assert.equal(plan.id, "original-id");
      assert.equal(plan.operations.length, 3);
      assert.equal(sent.length, 2, "First chunk must never be sent again");
      assert.deepEqual(
        plan.operations.map((op) => op.status),
        [acknowledged ? "sent" : "uncertain", "sent", "sent"],
      );
      assert.equal(
        plan.operations[0].messageId,
        acknowledged ? "platform-first" : null,
      );
      assert.equal(
        (await app.chats.state()).deliveries[0].status,
        acknowledged ? "sent" : "uncertain",
      );
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

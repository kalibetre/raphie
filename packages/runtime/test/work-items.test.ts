import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { UserMessage } from "@earendil-works/pi-ai";
import type { JsonObject } from "@earendil-works/pi-durable";
import type { WorkItem } from "@raphie/contracts";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import {
  MAX_LISTED,
  openWorkContext,
} from "../src/domains/work/domain/work-item.ts";
import { workRoutes } from "../src/domains/work/presentation/http/routes.ts";
import { InputError } from "../src/shared/application/input-error.ts";
import { chatModel } from "./chat-model.ts";

const item = (n: number, patch: Partial<WorkItem> = {}): WorkItem => ({
  id: `w-${n}`,
  title: `Item ${n}`,
  status: "active",
  notes: "",
  opened: { at: n, by: "bot" },
  updatedAt: n,
  ...patch,
});

test("the open work sent with a message: newest first, closed ones left out", () => {
  assert.equal(openWorkContext([]), "");
  assert.equal(openWorkContext([item(1, { status: "done" })]), "");
  const listed = openWorkContext([
    item(1, {
      title: "Flights to Lisbon",
      status: "waiting",
      waitingOn: "the owner to pick a date",
      result: { text: "Two options\nsent", at: Date.UTC(2026, 10, 25) },
    }),
    item(2, { title: "Venue research" }),
    item(3, { status: "dropped" }),
  ]);
  assert.equal(
    listed,
    "[Open work (2); work_read shows one in full]\n" +
      "w-2 Venue research: active\n" +
      "w-1 Flights to Lisbon: waiting on the owner to pick a date; last: Two options sent (2026-11-25)\n",
  );
});

test("a long list stops at its limit and says how many more there are", () => {
  const items = Array.from({ length: MAX_LISTED + 5 }, (_, n) => item(n + 1));
  const listed = openWorkContext(items).trimEnd().split("\n");
  assert.equal(
    listed[0],
    `[Open work (${MAX_LISTED + 5}); work_read shows one in full]`,
  );
  assert.equal(listed[1], `w-${MAX_LISTED + 5} Item ${MAX_LISTED + 5}: active`);
  assert.equal(listed.length, MAX_LISTED + 2);
  assert.equal(listed.at(-1), "…and 5 more: use work_list.");
});

/** A bot whose replies call the tool each message names. */
async function bot(calls: Record<string, { name: string; args: JsonObject }>) {
  const directory = await mkdtemp(join(tmpdir(), "raphie-work-"));
  const seen: string[] = [];
  const app = await Gateway.open({
    directory,
    ...chatModel({
      toolFor: (text) =>
        Object.entries(calls).find(([word]) => text.startsWith(word))?.[1],
      userMessages: (messages: UserMessage[]) => {
        const last = messages.at(-1)?.content;
        seen.push(
          typeof last === "string"
            ? last
            : (last ?? [])
                .flatMap((c) => (c.type === "text" ? [c.text] : []))
                .join(""),
        );
      },
    }),
  });
  const say = async (text: string, extra: Record<string, unknown> = {}) => {
    const sent = await app.chats.send({
      source: "web",
      actor: "owner",
      eventId: crypto.randomUUID(),
      text,
      ...extra,
    });
    await app.harness.waitForIdle(context);
    return (await app.chats.state()).turns.find((t) => t.id === sent.id)!;
  };
  return {
    app,
    say,
    seen,
    done: async () => {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("the bot opens, updates and closes a work item from its chat", async () => {
  const { app, say, seen, done } = await bot({
    open: {
      name: "work_open",
      args: {
        title: "Flights to Lisbon",
        status: "waiting",
        waitingOn: "the owner to pick a date",
      },
    },
    update: {
      name: "work_update",
      args: {
        id: "w-1",
        status: "active",
        notes: "Two options",
        result: "Found two flights",
      },
    },
    close: { name: "work_close", args: { id: "w-1", outcome: "done" } },
    again: { name: "work_update", args: { id: "w-1", notes: "More" } },
  });
  try {
    const opened = await say("open a flight search");
    assert.match(opened.answer!, /"opened":true/);
    let [flights] = await app.work.list({ open: true });
    assert.equal(flights?.id, "w-1");
    assert.equal(flights?.status, "waiting");
    assert.equal(flights?.waitingOn, "the owner to pick a date");
    assert.equal(flights?.sourceTurnId, opened.id);
    assert.equal(flights?.opened.by, "bot");

    // Every later message of the chat carries it.
    await say("hello");
    assert.match(
      seen.at(-1)!,
      /\[Open work \(1\); work_read shows one in full\]\nw-1 Flights to Lisbon: waiting on the owner to pick a date\n\nhello$/,
    );

    await say("update it");
    [flights] = await app.work.list({ open: true });
    assert.equal(flights?.status, "active");
    assert.equal(flights?.waitingOn, undefined);
    assert.equal(flights?.notes, "Two options");
    assert.equal(flights?.result?.text, "Found two flights");

    await say("close it");
    assert.deepEqual(await app.work.list({ open: true }), []);
    const [closed] = await app.work.list({ open: false });
    assert.equal(closed?.status, "done");
    assert.equal(closed?.closed?.by, "bot");
    // A closed item stays closed, and leaves the messages.
    assert.match((await say("again")).answer!, /w-1 is closed/);
    assert.doesNotMatch(seen.at(-1)!, /Open work/);
  } finally {
    await done();
  }
});

test("the owner reads work items over the API", async () => {
  const { app, say, done } = await bot({
    open: { name: "work_open", args: { title: "Venue research" } },
  });
  try {
    await say("open one");
    const routes = workRoutes(app.work).onError((error, c) =>
      error instanceof InputError
        ? c.json({ error: error.message }, error.status as 404)
        : c.json({ error: "?" }, 500),
    );
    const open = await (await routes.request("/")).json();
    assert.deepEqual(
      open.items.map((i: WorkItem) => [i.id, i.title]),
      [["w-1", "Venue research"]],
    );
    assert.deepEqual(
      (await (await routes.request("/?status=closed")).json()).items,
      [],
    );
    assert.equal(
      (await (await routes.request("/?q=venue")).json()).items.length,
      1,
    );
    assert.equal(
      (await (await routes.request("/?q=lisbon")).json()).items.length,
      0,
    );
    assert.equal(
      (await (await routes.request("/w-1")).json()).title,
      "Venue research",
    );
    assert.equal((await routes.request("/w-9")).status, 404);
  } finally {
    await done();
  }
});

test("a group never sees or changes the owner's work items", async () => {
  const { app, say, seen, done } = await bot({
    open: { name: "work_open", args: { title: "Private plan" } },
  });
  try {
    await say("open in the chat");
    const group = {
      source: "telegram",
      discordThreadId: "telegram:-100",
      connectionId: "telegram:1",
      discordUserId: "42",
    };
    const refused = await say("open in the group", group);
    assert.match(refused.answer!, /belong to your chat with the owner/);
    assert.equal((await app.work.list({ open: true })).length, 1);
    assert.doesNotMatch(seen.at(-1)!, /Open work|Private plan/);
  } finally {
    await done();
  }
});

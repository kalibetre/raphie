import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { UserMessage } from "@earendil-works/pi-ai";
import type { Attachment } from "@raphie/contracts";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { runtimeRoutes } from "../src/bootstrap/runtime-http-routes.ts";
import { chatModel } from "./chat-model.ts";

async function settled(gateway: Gateway) {
  for (
    let n = 0;
    n < 200 &&
    (await gateway.chats.state()).turns.some((t) => t.status === "pending");
    n++
  )
    await Bun.sleep(10);
  expect((await gateway.chats.state()).turns.at(-1)?.status).toBe("done");
}

async function upload(gateway: Gateway, name: string, bytes: Uint8Array) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name));
  const response = await runtimeRoutes(gateway).request("/api/attachments", {
    method: "POST",
    body: form,
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Attachment;
}

test("uploads become tool-readable workspace files with durable message references and immutable originals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-attachments-"));
  const tool = {
    name: "workspace_exec",
    args: { command: "cat uploads/*/note.txt" },
  };
  const fixture = chatModel({ tool });
  const options = { directory, ...fixture };
  let gateway = await Gateway.open(options);
  try {
    const file = await upload(
      gateway,
      "../note.txt",
      new TextEncoder().encode("original"),
    );
    expect(file.name).toBe("note.txt");
    expect(file.path).toBe(`/workspace/uploads/${file.id}/note.txt`);
    const actor = gateway.actors.establish("web");
    const input = { eventId: "file-message", text: "", attachments: [file.id] };
    const receipt = await gateway.sessions.submit(actor, input);
    await settled(gateway);
    expect((await gateway.chats.state()).turns[0]?.answer).toContain(
      "original",
    );
    const retry = await gateway.sessions.submit(actor, input);
    expect(retry).toEqual(receipt);
    const other = await upload(gateway, "other.txt", new Uint8Array([1, 2]));
    await assert.rejects(
      gateway.sessions.submit(actor, { ...input, attachments: [other.id] }),
      /different content/,
    );
    await gateway.workspace.execute(
      "owner",
      "edit",
      `printf changed > ${file.path}`,
    );
    expect(
      await (
        await runtimeRoutes(gateway).request(`/api/files/${file.id}`)
      ).text(),
    ).toBe("original");
    await gateway.close();
    gateway = await Gateway.open(options);
    expect((await gateway.chats.state()).turns[0]?.attachments).toEqual([file]);
    expect(
      await (
        await runtimeRoutes(gateway).request(`/api/files/${file.id}`)
      ).text(),
    ).toBe("original");
    const otherBot = await Gateway.open({
      directory: join(directory, "other"),
      ...fixture,
    });
    try {
      await assert.rejects(
        Promise.resolve(
          runtimeRoutes(otherBot).request(`/api/files/${file.id}`),
        ),
        /File not found/,
      );
      await assert.rejects(
        otherBot.sessions.submit(otherBot.actors.establish("web"), {
          ...input,
          eventId: "cross-bot",
        }),
        /unavailable for this bot/,
      );
    } finally {
      await otherBot.close();
    }
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const images of [true, false])
  test(`image inputs follow model capability; PDFs remain tool files (images=${images})`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "raphie-images-"));
    let messages: UserMessage[] = [];
    const fixture = chatModel({
      images,
      userMessages: (value) => {
        messages = value;
      },
    });
    const gateway = await Gateway.open({ directory, ...fixture });
    try {
      const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
      const image = await upload(gateway, "misleading.txt", png);
      const pdf = await upload(
        gateway,
        "document.pdf",
        new TextEncoder().encode("%PDF-1.7 fixture"),
      );
      expect(image.mimeType).toBe("image/png");
      expect(pdf.mimeType).toBe("application/pdf");
      await gateway.sessions.submit(gateway.actors.establish("web"), {
        eventId: "inspect",
        text: "Inspect these",
        attachments: [image.id, pdf.id],
      });
      await settled(gateway);
      const content = messages.at(-1)?.content;
      const parts = typeof content === "string" ? [] : (content ?? []);
      expect(parts.filter((p) => p.type === "image").length).toBe(
        images ? 1 : 0,
      );
      if (images)
        expect(parts.find((p) => p.type === "image")).toEqual({
          type: "image",
          mimeType: "image/png",
          data: Buffer.from(png).toString("base64"),
        });
      expect(JSON.stringify(content)).toContain("not model document inputs");
      expect(JSON.stringify(content)).toContain(pdf.path!);
    } finally {
      await gateway.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

test("failed workspace imports do not admit a message or lose the existing checkpoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-upload-limit-"));
  const gateway = await Gateway.open({ directory, ...chatModel() });
  try {
    await gateway.files.upload("full", new Uint8Array(8 * 1024 * 1024));
    await assert.rejects(
      gateway.files.upload("extra", new Uint8Array([1])),
      /checkpoint limits/,
    );
    expect((await gateway.chats.state()).turns).toEqual([]);
    expect(
      (await gateway.workspace.list("/workspace/uploads")).items.length,
    ).toBe(1);
    expect(
      (
        await gateway.workspace.execute(
          "s",
          "still-works",
          "test -f uploads/*/full",
        )
      ).exitCode,
    ).toBe(0);
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("queued attachment messages retain references through steer, queue and stop controls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-queued-upload-"));
  const pause = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const gateway = await Gateway.open({
    directory,
    ...chatModel({ pause: pause.promise, started: () => started.resolve() }),
  });
  const actor = gateway.actors.establish("web");
  const until = async (check: () => Promise<boolean>) => {
    for (let n = 0; n < 200; n++) {
      if (await check()) return;
      await Bun.sleep(10);
    }
    throw new Error("Queued attachment did not reach expected state");
  };
  try {
    const first = await gateway.sessions.submit(actor, {
      eventId: "first",
      text: "Working",
    });
    await started.promise;
    const file = await upload(
      gateway,
      "queued.txt",
      new TextEncoder().encode("saved"),
    );
    const queued = await gateway.sessions.submit(actor, {
      eventId: "second",
      text: "",
      sessionId: first.sessionId,
      attachments: [file.id],
    });
    await until(
      async () =>
        !!(await gateway.chats.state()).turns.find((t) => t.id === queued.id)
          ?.queueMode,
    );
    await gateway.sessions.control(actor, first.sessionId, "steer", queued.id);
    expect(
      (await gateway.chats.state()).turns.find((t) => t.id === queued.id)
        ?.queueMode,
    ).toBe("steer");
    await gateway.sessions.control(actor, first.sessionId, "queue", queued.id);
    expect(
      (await gateway.chats.state()).turns.find((t) => t.id === queued.id)
        ?.attachments,
    ).toEqual([file]);
    await gateway.sessions.control(actor, first.sessionId, "stop");
    pause.resolve();
    await until(async () =>
      (await gateway.chats.state()).turns.every((t) => t.status !== "pending"),
    );
    expect(
      (await gateway.queries.history(actor, first.sessionId)).items.find(
        (t) => t.id === queued.id,
      )?.attachments,
    ).toEqual([file]);
  } finally {
    pause.resolve();
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("recovery retains admitted image bytes even after the working copy changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-image-recovery-"));
  const started = Promise.withResolvers<void>();
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  let messages: UserMessage[] = [];
  let gateway = await Gateway.open({
    directory,
    ...chatModel({
      images: true,
      started: () => started.resolve(),
      pause: new Promise(() => {}),
    }),
  });
  try {
    const file = await upload(gateway, "image.png", png);
    await gateway.sessions.submit(gateway.actors.establish("web"), {
      eventId: "resume-image",
      text: "Inspect",
      attachments: [file.id],
    });
    await started.promise;
    await gateway.workspace.execute(
      "owner",
      "change-copy",
      `printf changed > ${file.path}`,
    );
    await gateway.close();
    gateway = await Gateway.open({
      directory,
      ...chatModel({
        images: true,
        userMessages: (value) => {
          messages = value;
        },
      }),
    });
    await settled(gateway);
    const content = messages.at(-1)?.content;
    expect(
      typeof content !== "string" && content?.find((p) => p.type === "image"),
    ).toEqual({
      type: "image",
      data: Buffer.from(png).toString("base64"),
      mimeType: "image/png",
    });
    expect((await gateway.chats.state()).turns.length).toBe(1);
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
});

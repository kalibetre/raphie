import { test } from "bun:test";
import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";

import { AttachmentCard } from "../src/domains/conversations/presentation/attachment-card";
import {
  AttachmentChips,
  ComposerAttachments,
} from "../src/domains/conversations/presentation/composer-attachments";
import { readDraftAttachments } from "../src/domains/conversations/presentation/use-composer-attachments";
import { BackendWorkspace } from "../src/infrastructure/http/backend-workspace";

const file = { id: "a".repeat(64), name: "<report & notes>.pdf", size: 200 };

test("attachment controls name the chooser and removable files without interpreting filenames as markup", () => {
  const html = renderToStaticMarkup(
    <>
      <ComposerAttachments
        files={[file]}
        disabled={false}
        onUpload={() => {}}
      />
      <AttachmentChips
        files={[file]}
        workspace={new BackendWorkspace("")}
        disabled={false}
        onRemove={() => {}}
      />
    </>,
  );
  assert.match(html, /aria-label="Attach files"/);
  assert.match(html, /type="file"/);
  assert.match(html, /aria-label="Remove &lt;report &amp; notes&gt;.pdf"/);
  assert.ok(!html.includes("<report & notes>"));
  const disabled = renderToStaticMarkup(
    <ComposerAttachments
      files={Array.from({ length: 4 }, () => file)}
      disabled={false}
      onUpload={() => {}}
    />,
  );
  assert.match(disabled, /<button[^>]+disabled/);
});

test("message attachments show a named download action and image card", () => {
  const workspace = new BackendWorkspace("");
  try {
    const image = {
      ...file,
      name: "photo.png",
      mimeType: "image/png",
      size: 2048,
    };
    const html = renderToStaticMarkup(
      <AttachmentCard file={image} workspace={workspace} />,
    );
    assert.match(html, /data-image="true"/);
    assert.match(html, /aria-label="Download photo.png"/);
    assert.match(html, /2.0 KB/);
    assert.ok(!html.includes("/workspace/"));
  } finally {
    workspace.dispose();
  }
});

test("saved attachment drafts remain scoped and tolerate invalid or unavailable storage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => values.get(key) ?? null },
  });
  const a = new BackendWorkspace("http://one", "research");
  const b = new BackendWorkspace("http://one", "other");
  try {
    const key = a.draftKey("session");
    values.set(`${key}:attachments`, JSON.stringify([file]));
    assert.deepEqual(readDraftAttachments(key), [file]);
    assert.deepEqual(readDraftAttachments(b.draftKey("session")), []);
    values.set(`${key}:attachments`, "invalid");
    assert.deepEqual(readDraftAttachments(key), []);
    values.set(
      `${key}:attachments`,
      JSON.stringify([null, { id: "../file", name: "bad", size: 2 }, file]),
    );
    assert.deepEqual(readDraftAttachments(key), [file]);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("Storage unavailable");
      },
    });
    assert.deepEqual(readDraftAttachments(key), []);
  } finally {
    a.dispose();
    b.dispose();
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("multipart uploads retain bot/backend scope, CSRF header and retirement checks", async () => {
  const original = globalThis.fetch;
  const workspace = new BackendWorkspace("http://backend", "research");
  let finish!: (response: Response) => void;
  globalThis.fetch = (async (path: string, options: RequestInit) => {
    assert.equal(path, "/api/bots/research/attachments");
    assert.equal(options.method, "POST");
    assert.ok(options.body instanceof FormData);
    const headers = new Headers(options.headers);
    assert.equal(headers.get("x-raphie-backend"), workspace.url);
    assert.equal(headers.get("x-raphie-client"), "web");
    assert.equal(
      headers.get("content-type"),
      null,
      "fetch generates the multipart boundary",
    );
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  }) as typeof fetch;
  try {
    const form = new FormData();
    form.append("file", new File(["saved"], "note.txt"));
    const pending = workspace.api("/api/attachments", form);
    workspace.dispose();
    finish(Response.json(file));
    await assert.rejects(pending, /backend workspace changed/);
  } finally {
    workspace.dispose();
    globalThis.fetch = original;
  }
});

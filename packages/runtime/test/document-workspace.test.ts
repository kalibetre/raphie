import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { chatModel } from "./chat-model.ts";

async function runDocument(
  name: string,
  bytes: Uint8Array,
  path = `/workspace/uploads/test/${name}`,
  offset = 0,
) {
  const directory = await mkdtemp(join(tmpdir(), "raphie-document-"));
  const gateway = await Gateway.open({
    directory,
    ...chatModel({ tool: { name: "read_document", args: { path, offset } } }),
  });
  try {
    await gateway.workspace.putFile(`/workspace/uploads/test/${name}`, bytes);
    await gateway.sessions.submit(gateway.actors.establish("web"), {
      eventId: "document",
      text: "Read the document",
    });
    for (
      let i = 0;
      i < 400 &&
      (await gateway.chats.state()).turns.some((t) => t.status === "pending");
      i++
    )
      await Bun.sleep(20);
    return (await gateway.chats.state()).turns[0]?.answer ?? "";
  } finally {
    await gateway.close();
    await rm(directory, { recursive: true, force: true });
  }
}

for (const [name, expected] of [
  ["sample.pdf", "Distinctive PDF document"],
  ["sample.docx", "Distinctive Word document"],
  ["sample.xlsx", "Distinctive spreadsheet"],
])
  test(`reads ${name} through a real Pi tool call`, async () => {
    const bytes = await Bun.file(
      join(import.meta.dir, "fixtures/documents", name),
    ).bytes();
    expect(await runDocument(name, bytes)).toContain(expected);
  });

test("reads CSV and returns a continuation for long output", async () => {
  const bytes = Buffer.from(`name,value\n${"entry,42\n".repeat(3000)}`);
  const first = await runDocument("report.csv", bytes);
  expect(first).toContain('"nextOffset":16000');
  const second = await runDocument("report.csv", bytes, undefined, 16000);
  expect(second).toContain('"offset":16000');
  expect(second).toContain("entry");
});

test("mixed PDFs retain readable text and disclose missing scanned pages", async () => {
  const bytes = await Bun.file(
    join(import.meta.dir, "fixtures/documents/mixed.pdf"),
  ).bytes();
  const answer = await runDocument("mixed.pdf", bytes);
  expect(answer).toContain("Readable page");
  expect(answer).toContain("Pages with no extracted text: 2");
  expect(answer).toContain("partial");
});

test("rejects malformed documents and paths outside the workspace", async () => {
  expect(
    await runDocument("broken.pdf", Buffer.from("%PDF-1.7 broken")),
  ).toContain("malformed");
  expect(
    await runDocument(
      "note.csv",
      Buffer.from("one,two"),
      "/workspace/../settings.sqlite",
    ),
  ).toContain("inside /workspace");
});

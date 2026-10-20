import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  Files,
  MAX_FILE_BYTES,
} from "../src/domains/attachments/infrastructure/local-attachment-store.ts";

test("untrusted names stay metadata, bytes round-trip, and repeated uploads share a reference", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raphie-files-"));
  try {
    const files = new Files(directory);
    const bytes = Buffer.from([0, 255, 1, 128]);
    const ref = await files.put("../../private\\report.txt", bytes);
    assert.equal(ref.name, "report.txt");
    assert.deepEqual(await files.read(ref.id), bytes);
    assert.deepEqual(await files.put("report.txt", bytes), ref);
    await assert.rejects(files.read("../private"));
    await assert.rejects(
      files.put("large", Buffer.alloc(MAX_FILE_BYTES + 1)),
      /8 MiB/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

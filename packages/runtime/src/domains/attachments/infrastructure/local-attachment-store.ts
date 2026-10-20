import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { attachmentName, MAX_ATTACHMENT_BYTES } from "../domain/policy.ts";

export const MAX_FILE_BYTES = MAX_ATTACHMENT_BYTES;

export type FileRef = { id: string; name: string; size: number };

/** Content-addressed local files; original names never become paths. */
export class Files {
  directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async put(name: string, bytes: Uint8Array): Promise<FileRef> {
    if (bytes.byteLength > MAX_FILE_BYTES)
      throw new Error("Files must be 8 MiB or smaller.");
    name = attachmentName(name);
    const id = createHash("sha256")
      .update(name)
      .update("\0")
      .update(bytes)
      .digest("hex");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `.upload-${randomUUID()}`);
    await writeFile(temporary, bytes, { mode: 0o600, flush: true });
    await rename(temporary, join(this.directory, id));
    return { id, name, size: bytes.byteLength };
  }

  async read(id: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid file reference.");
    return readFile(join(this.directory, id));
  }
}

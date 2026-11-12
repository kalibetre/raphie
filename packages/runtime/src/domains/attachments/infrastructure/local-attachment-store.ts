import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Attachment } from "@raphie/contracts";

import { ModelConnectionGate } from "../../../shared/infrastructure/model-connection-gate.ts";
import { syncDirectory } from "../../../shared/infrastructure/sync-directory.ts";
import {
  attachmentName,
  imageMime,
  MAX_ATTACHMENT_BYTES,
} from "../domain/policy.ts";

export const MAX_FILE_BYTES = MAX_ATTACHMENT_BYTES;

export type FileRef = Attachment;

/** Content-addressed local files; original names never become paths. */
export class Files {
  directory: string;
  private readonly gate: ModelConnectionGate;

  private readonly workspace?: {
    putFile(path: string, bytes: Uint8Array): Promise<void>;
  };

  constructor(
    directory: string,
    workspace?: { putFile(path: string, bytes: Uint8Array): Promise<void> },
    gate = new ModelConnectionGate(),
  ) {
    this.gate = gate;
    this.workspace = workspace;
    this.directory = directory;
  }

  put(name: string, bytes: Uint8Array): Promise<FileRef> {
    return this.gate.run(() => this.write(name, bytes));
  }

  private async write(name: string, bytes: Uint8Array): Promise<FileRef> {
    if (bytes.byteLength > MAX_FILE_BYTES)
      throw new Error("Files must be 8 MiB or smaller.");
    name = attachmentName(name);
    const id = new Bun.CryptoHasher("sha256")
      .update(name)
      .update("\0")
      .update(bytes)
      .digest("hex");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `.upload-${crypto.randomUUID()}`);
    await writeFile(temporary, bytes, { mode: 0o600, flush: true });
    await rename(temporary, join(this.directory, id));
    await syncDirectory(this.directory);
    return { id, name, size: bytes.byteLength };
  }

  /** General uploads publish a working file; approval workflow blobs stay archival. */
  upload(name: string, bytes: Uint8Array): Promise<Attachment> {
    return this.gate.run(() => this.publishUpload(name, bytes));
  }

  private async publishUpload(
    name: string,
    bytes: Uint8Array,
  ): Promise<Attachment> {
    if (!this.workspace) throw new Error("Workspace uploads are unavailable.");
    const original = await this.write(name, bytes);
    const characters = Array.from(original.name);
    while (Buffer.byteLength(characters.join("")) > 200) characters.pop();
    const path = `/workspace/uploads/${original.id}/${characters.join("")}`;
    const ref: Attachment = {
      ...original,
      path,
      mimeType:
        imageMime(bytes) ??
        (Buffer.from(bytes).subarray(0, 5).toString() === "%PDF-"
          ? "application/pdf"
          : "application/octet-stream"),
    };
    await this.workspace.putFile(path, bytes);
    const manifest = join(this.directory, `.metadata-${crypto.randomUUID()}`);
    await writeFile(manifest, JSON.stringify(ref), {
      mode: 0o600,
      flush: true,
    });
    await rename(manifest, join(this.directory, `${ref.id}.json`));
    await syncDirectory(this.directory);
    return ref;
  }

  async describe(id: string): Promise<Attachment> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid file reference.");
    return (await Bun.file(
      join(this.directory, `${id}.json`),
    ).json()) as Attachment;
  }

  async read(id: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid file reference.");
    return Buffer.from(await Bun.file(join(this.directory, id)).arrayBuffer());
  }
}

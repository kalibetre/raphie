import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export type FileRef = { id: string; name: string; size: number };

/** Content-addressed local files; original names never become paths. */
export class Files {
  directory: string;
  constructor(directory: string) { this.directory = directory; }

  async put(name: string, bytes: Uint8Array): Promise<FileRef> {
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('Files must be 8 MiB or smaller.');
    name = name.replaceAll('\\', '/').split('/').at(-1)!
      .replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) || 'attachment';
    const id = createHash('sha256').update(name).update('\0').update(bytes).digest('hex');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `.upload-${randomUUID()}`);
    await writeFile(temporary, bytes, { mode: 0o600, flush: true });
    await rename(temporary, join(this.directory, id));
    return { id, name, size: bytes.byteLength };
  }

  async read(id: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid file reference.');
    return readFile(join(this.directory, id));
  }
}

import { inflateRawSync } from "node:zlib";

import { InputError } from "../../../shared/application/input-error.ts";

/** The most an archive may expand to, so a small upload cannot fill memory. */
const EXPANDED_LIMIT = 32 * 1024 * 1024;
const ENTRY_LIMIT = 2000;

/** Files from an archive, by their path inside it. Folders are left out. */
export type ArchiveFiles = Map<string, Uint8Array>;

/**
 * The files in a .zip: stored or deflated entries, read from its central
 * directory. Encrypted entries, and archives that would expand past the
 * limit, are refused.
 */
export function readZip(bytes: Uint8Array): ArchiveFiles {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bad = () => new InputError("This is not a .zip file Raphie can read.");
  // The end-of-central-directory record sits within the last 64 KiB.
  let end = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 22 - 0xffff);
    i--
  )
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw bad();
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (count > ENTRY_LIMIT)
    throw new InputError(`An archive holds at most ${ENTRY_LIMIT} files.`);
  const files: ArchiveFiles = new Map();
  let expanded = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50)
      throw bad();
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(at + 46, at + 46 + nameLength),
    );
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (flags & 1)
      throw new InputError("Encrypted archives are not supported.");
    expanded += size;
    if (expanded > EXPANDED_LIMIT)
      throw new InputError("This archive expands to more than 32 MiB.");
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50)
      throw bad();
    const start =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compressed);
    let content: Uint8Array;
    if (method === 0) content = data;
    else if (method === 8)
      content = new Uint8Array(
        inflateRawSync(data, { maxOutputLength: size + 1 }),
      );
    else throw new InputError(`${name} uses a compression Raphie cannot read.`);
    if (content.length !== size) throw bad();
    files.set(name, content);
  }
  return files;
}

/**
 * The files in a .tar.gz, such as the one GitHub serves for a repository;
 * with `glob`, only those it matches.
 */
export async function readTarGz(
  bytes: Uint8Array,
  glob?: string,
): Promise<ArchiveFiles> {
  let entries: Map<string, File>;
  try {
    entries = await new Bun.Archive(bytes).files(glob);
  } catch {
    throw new InputError("This is not an archive Raphie can read.");
  }
  if (entries.size > ENTRY_LIMIT * 20)
    throw new InputError("This repository has too many files to import.");
  const files: ArchiveFiles = new Map();
  let expanded = 0;
  for (const [path, file] of entries) {
    expanded += file.size;
    if (expanded > EXPANDED_LIMIT)
      throw new InputError("These skills expand to more than 32 MiB.");
    files.set(path, await file.bytes());
  }
  return files;
}

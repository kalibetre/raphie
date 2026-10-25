/** Small JSON transport shared with the process running inside the container. */
export function encodeWire(value: unknown): unknown {
  if (value instanceof Uint8Array)
    return { $bytes: Buffer.from(value).toString("base64") };
  if (value instanceof Error)
    return {
      ...Object.fromEntries(Object.entries(value)),
      $error: true,
      message: value.message,
    };
  if (Array.isArray(value)) return value.map(encodeWire);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, encodeWire(item)]),
    );
  return value;
}

export function decodeWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeWire);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.$bytes === "string")
      return new Uint8Array(Buffer.from(record.$bytes, "base64"));
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [key, decodeWire(item)]),
    );
  }
  return value;
}

export const envMethods = [
  "absolutePath",
  "joinPath",
  "readTextFile",
  "openTextLineReader",
  "readTextLines",
  "readBinaryFile",
  "openBinaryReader",
  "writeFile",
  "appendFile",
  "truncateFile",
  "flushFile",
  "renameFile",
  "fileInfo",
  "listDir",
  "openDirReader",
  "watch",
  "canonicalPath",
  "exists",
  "createDir",
  "remove",
  "createTempDir",
  "createTempFile",
  "exec",
] as const;

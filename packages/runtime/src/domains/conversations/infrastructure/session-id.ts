// Bun implements RFC 9562 UUIDv7, including a timestamp for legacy backfills.
export function newSessionId(at = Date.now()) {
  return Bun.randomUUIDv7("hex", at);
}

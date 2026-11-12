import { createHash, randomInt, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LENGTH = 10;

export const PAIRING_TTL_MS = 10 * 60 * 1000;

const MAX_FAILURES = 5;

const digest = (code: string) =>
  createHash("sha256")
    .update(code.replace(/[^A-Za-z0-9]/g, "").toUpperCase())
    .digest();

/**
 * One live, single-use code, held in memory only. A restart or a fifth wrong
 * guess invalidates it, so brute force is bounded to five tries in ten minutes.
 */
export class PairingCodes {
  private live: { hash: Buffer; expiresAt: number; failures: number } | null =
    null;

  issue(now = Date.now()) {
    const raw = Array.from(
      { length: LENGTH },
      () => ALPHABET[randomInt(ALPHABET.length)],
    ).join("");
    this.live = {
      hash: digest(raw),
      expiresAt: now + PAIRING_TTL_MS,
      failures: 0,
    };
    return {
      code: `${raw.slice(0, 5)}-${raw.slice(5)}`,
      expiresAt: this.live.expiresAt,
    };
  }

  expiresAt(now = Date.now()) {
    if (this.live && this.live.expiresAt <= now) this.live = null;
    return this.live?.expiresAt ?? null;
  }

  consume(code: string, now = Date.now()) {
    if (this.expiresAt(now) === null || !this.live) return false;
    if (timingSafeEqual(this.live.hash, digest(code))) {
      this.live = null;
      return true;
    }
    if (++this.live.failures >= MAX_FAILURES) this.live = null;
    return false;
  }

  clear() {
    this.live = null;
  }
}

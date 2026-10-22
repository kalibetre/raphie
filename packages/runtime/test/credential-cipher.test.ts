import { test } from "bun:test";
import assert from "node:assert/strict";

import { CredentialCipher } from "../src/domains/settings/infrastructure/credential-cipher.ts";
import { memoryCredentialKeyStore } from "./credential-store.ts";

test("credentials authenticate connection identity and survive reopening only with the OS key", async () => {
  const store = memoryCredentialKeyStore();
  const cipher = await CredentialCipher.open(store);
  const encrypted = cipher.encrypt(
    "SYNTHETIC_CREDENTIAL",
    "personal",
    "openrouter",
  )!;
  assert.equal(
    JSON.stringify(encrypted).includes("SYNTHETIC_CREDENTIAL"),
    false,
  );
  assert.equal(
    cipher.decrypt(encrypted, "personal", "openrouter"),
    "SYNTHETIC_CREDENTIAL",
  );
  assert.notDeepEqual(
    encrypted,
    cipher.encrypt("SYNTHETIC_CREDENTIAL", "personal", "openrouter"),
  );
  assert.throws(
    () => cipher.decrypt(encrypted, "work", "openrouter"),
    /authenticated/,
  );
  assert.throws(
    () => cipher.decrypt(encrypted, "personal", "other"),
    /authenticated/,
  );
  assert.throws(
    () =>
      cipher.decrypt(
        { ...encrypted, tag: Buffer.alloc(16).toString("base64") },
        "personal",
        "openrouter",
      ),
    /authenticated/,
  );
  const reopened = await CredentialCipher.open(store, cipher.keyId);
  assert.equal(
    reopened.decrypt(encrypted, "personal", "openrouter"),
    "SYNTHETIC_CREDENTIAL",
  );
  await assert.rejects(
    CredentialCipher.open(memoryCredentialKeyStore(), cipher.keyId),
    /key missing/,
  );
  cipher.close();
  reopened.close();
});

test("key-store errors and failed readback are redacted and never fall back", async () => {
  await assert.rejects(
    CredentialCipher.open({
      get: async () => {
        throw new Error("SYNTHETIC_SECRET_ERROR");
      },
      set: async () => {},
    }),
    (error: Error) =>
      !String(error).includes("SYNTHETIC") &&
      String(error).includes("unavailable"),
  );
  await assert.rejects(
    CredentialCipher.open({ get: async () => null, set: async () => {} }),
    /unavailable/,
  );
});

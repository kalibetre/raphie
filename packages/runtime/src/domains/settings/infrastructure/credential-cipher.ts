import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { secrets } from "bun";

import type { EncryptedCredential } from "../../../shared/application/encrypted-credential.ts";
import { InputError } from "../../../shared/application/input-error.ts";

export type { EncryptedCredential } from "../../../shared/application/encrypted-credential.ts";

const service = "com.raphie.provider-credentials";

/** Injectable only at the persistence boundary; production always uses the OS store. */
export type CredentialKeyStore = {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
};

export const osCredentialKeyStore: CredentialKeyStore = {
  get: (name) => secrets.get({ service, name }),
  set: (name, value) => secrets.set({ service, name, value }),
};

/** AES-256-GCM; SQLite contains only ciphertext and a non-secret OS key identifier. */
export class CredentialCipher {
  readonly keyId: string;
  private key: Buffer;

  private constructor(keyId: string, key: Buffer) {
    this.keyId = keyId;
    this.key = key;
  }

  static async open(store: CredentialKeyStore, existingKeyId?: string) {
    const keyId = existingKeyId ?? crypto.randomUUID();
    try {
      let value = await store.get(keyId);
      if (value === null && !existingKeyId) {
        value = randomBytes(32).toString("base64");
        await store.set(keyId, value);
        // Do not replace plaintext until durable OS storage can be read back.
        if ((await store.get(keyId)) !== value) throw new Error();
      }
      if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error();
      return new CredentialCipher(keyId, Buffer.from(value, "base64"));
    } catch {
      // OS errors can contain secret material. Never propagate them or their causes.
      throw new InputError(
        "Provider credential store unavailable or key missing. Unlock the OS credential store and restart; restore the matching credential-store backup if the key was deleted. No plaintext fallback is available.",
        503,
      );
    }
  }

  private aad(id: string, provider: string) {
    return Buffer.from(
      JSON.stringify(["raphie-provider-key-v4", this.keyId, id, provider]),
    );
  }

  encrypt(
    value: string | null,
    id: string,
    provider: string,
  ): EncryptedCredential | null {
    if (value === null) return null;
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(this.aad(id, provider));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return {
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  }

  decrypt(value: EncryptedCredential | null, id: string, provider: string) {
    if (value === null) return null;
    try {
      const nonce = Buffer.from(value.nonce, "base64");
      const tag = Buffer.from(value.tag, "base64");
      if (nonce.length !== 12 || tag.length !== 16) throw new Error();
      const cipher = createDecipheriv("aes-256-gcm", this.key, nonce);
      cipher.setAAD(this.aad(id, provider));
      cipher.setAuthTag(tag);
      return Buffer.concat([
        cipher.update(Buffer.from(value.ciphertext, "base64")),
        cipher.final(),
      ]).toString("utf8");
    } catch {
      throw new InputError(
        "Provider credentials could not be authenticated. Restore matching settings and OS credential-store backups; saved connections were not changed.",
        503,
      );
    }
  }

  close() {
    this.key.fill(0);
  }
}

import type { CredentialKeyStore } from "../src/domains/settings/infrastructure/credential-cipher.ts";

/** Synthetic test storage; never used by runtime bootstrap. */
export function memoryCredentialKeyStore(): CredentialKeyStore {
  const values = new Map<string, string>();
  return {
    get: async (name) => values.get(name) ?? null,
    set: async (name, value) => {
      values.set(name, value);
    },
  };
}

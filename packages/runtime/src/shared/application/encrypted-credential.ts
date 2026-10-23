export type EncryptedCredential = {
  nonce: string;
  ciphertext: string;
  tag: string;
};

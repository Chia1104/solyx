import type { SecretCipher } from "../src/main/modules/settings/secret-store.ts";

/** Tags ciphertext with a key id and reverses the text, so plain text never appears on disk. */
export function fakeCipher() {
  const os = {
    available: true,
    keyId: "k1",
    /** Key ids that still decrypt but ask for re-encryption. */
    retiredKeyIds: new Set<string>(),
  };

  const cipher: SecretCipher = {
    isAvailable: async () => os.available,
    encrypt: async (plainText) =>
      Buffer.from(`${os.keyId}:${[...plainText].toReversed().join("")}`),
    decrypt: async (encrypted) => {
      // Only the first colon ends the key id; values such as JSON hold their own.
      const text = encrypted.toString();
      const keyId = text.slice(0, text.indexOf(":"));
      const body = text.slice(keyId.length + 1);

      if (keyId !== os.keyId && !os.retiredKeyIds.has(keyId)) {
        throw new Error("Unknown key");
      }

      return {
        plainText: [...body].toReversed().join(""),
        shouldReEncrypt: keyId !== os.keyId,
      };
    },
  };

  return { os, cipher };
}

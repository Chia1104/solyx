import { safeStorage } from "electron";

import type { SecretCipher } from "./secret-store.ts";

/** Electron's safeStorage: its key lives in the Keychain on macOS, under DPAPI on Windows, and in libsecret or KWallet on Linux. */
export const electronCipher: SecretCipher = {
  async isAvailable() {
    // Without a keyring, Linux encrypts with a hardcoded password, which is plain text in effect.
    if (
      process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text"
    ) {
      return false;
    }

    return safeStorage.isAsyncEncryptionAvailable();
  },

  encrypt: (plainText) => safeStorage.encryptStringAsync(plainText),

  async decrypt(encrypted) {
    const { result, shouldReEncrypt } =
      await safeStorage.decryptStringAsync(encrypted);

    return { plainText: result, shouldReEncrypt };
  },
};

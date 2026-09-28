import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// PIN vault encryption (plan F4). AES-256-GCM with a 32-byte key from IOT_PMS_PIN_KEY (base64). The device ID is
// bound as additional data, so a ciphertext copied onto another device's row does not decrypt.
// Stored form: "v<keyVersion>.<iv>.<tag>.<ciphertext>" (base64url parts). The key version allows rotation later.

export const KEY_VERSION = 1;

export function parsePinKey(value: string | undefined): Buffer | undefined {
  if (!value) return undefined;
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("IOT_PMS_PIN_KEY must be 32 bytes, base64-encoded (e.g. `openssl rand -base64 32`)");
  return key;
}

export function encryptPin(pin: string, deviceId: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(deviceId));
  const ct = Buffer.concat([cipher.update(pin, "utf8"), cipher.final()]);
  return [`v${KEY_VERSION}`, iv, cipher.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/** Throws on a wrong key, a different device, or any tampering (GCM authentication). */
export function decryptPin(stored: string, deviceId: string, key: Buffer): string {
  const [version, iv, tag, ct] = stored.split(".");
  if (version !== `v${KEY_VERSION}` || !iv || !tag || !ct) throw new Error("Unknown PIN ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(deviceId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

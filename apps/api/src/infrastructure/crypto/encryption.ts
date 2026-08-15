import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { loadConfig } from "@babasti/config";

/**
 * AES-256-GCM encryption for secrets at rest (OAuth tokens, environment
 * variables, GitHub access tokens). The key is derived from ENCRYPTION_KEY
 * (falling back to SESSION_SECRET). Secrets are never logged.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

function deriveKey(): Buffer {
  const config = loadConfig();
  const material = process.env.ENCRYPTION_KEY ?? config.SESSION_SECRET;
  return scryptSync(material, "babasti-static-salt", 32);
}

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (!cachedKey) cachedKey = deriveKey();
  return cachedKey;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // format: saltless base64(iv).base64(tag).base64(data)
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted payload");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

/** Encrypt optional value (returns undefined when not provided). */
export function encryptNullable(value: string | null | undefined): string | null {
  return value == null || value === "" ? null : encrypt(value);
}

export function decryptNullable(value: string | null | undefined): string | null {
  return value == null || value === "" ? null : decrypt(value);
}

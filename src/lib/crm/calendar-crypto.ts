import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type Env = Record<string, string | undefined>;

function key(env: Env) {
  const hex = env.CRM_CALENDAR_TOKEN_KEY;
  if (!hex || !/^[a-f0-9]{64}$/i.test(hex))
    throw new Error("Calendar token encryption key is not configured.");
  return Buffer.from(hex, "hex");
}

/** AES-256-GCM, IV and auth tag prefixed to the ciphertext, all base64-encoded together. */
export function encryptCalendarToken(env: Env, plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(env), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptCalendarToken(env: Env, encoded: string) {
  const raw = Buffer.from(encoded, "base64");
  if (raw.length < 29) throw new Error("Invalid encrypted token.");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(env), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

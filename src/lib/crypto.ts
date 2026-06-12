/**
 * Authenticated symmetric encryption for storing third-party credentials at
 * rest. AES-256-GCM, key derived from the `TICKTICK_ENC_KEY` env var.
 *
 * Accepted key formats:
 *   - 32-byte key as 64 hex chars
 *   - 32-byte key as 44-char base64 (RFC 4648, with padding)
 *   - any other passphrase — hashed to 32 bytes via SHA-256 (works, but a
 *     truly random 32-byte key from `openssl rand -hex 32` is better)
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

let cachedKey: Buffer | null = null;

function deriveKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.TICKTICK_ENC_KEY;
  if (!raw) {
    throw new Error(
      "TICKTICK_ENC_KEY is not set. Generate one with `openssl rand -hex 32` and add it to .env.local. See TICKTICK_SETUP.md.",
    );
  }
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    try {
      const b = Buffer.from(raw, "base64");
      key = b.length === 32 ? b : createHash("sha256").update(raw).digest();
    } catch {
      key = createHash("sha256").update(raw).digest();
    }
  }
  cachedKey = key;
  return key;
}

export interface Encrypted {
  ciphertext: string; // base64
  iv: string;         // base64
  tag: string;        // base64 (GCM auth tag)
}

export function encryptString(plaintext: string): Encrypted {
  const key = deriveKey();
  const iv = randomBytes(12); // GCM recommended IV length
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptString(parts: Encrypted): string {
  const key = deriveKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(parts.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(parts.tag, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(parts.ciphertext, "base64")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}

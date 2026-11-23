import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/* ============================================================
   PASSWORD HASHING — scrypt (Node built-in, no dependency)
   Stored format:  scrypt$<iterations>$<salt-b64>$<hash-b64>
   ============================================================ */

const KEYLEN = 64;
const SALT_BYTES = 16;
const ITERATIONS = 16384;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, KEYLEN, { N: ITERATIONS, r: 8, p: 1 });
  return `scrypt$${ITERATIONS}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, iterStr, saltB64, hashB64] = stored.split("$");
    if (scheme !== "scrypt" || !iterStr || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, "base64");
    const derived = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(iterationsOrDefault(iterStr)),
      r: 8,
      p: 1,
    });
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

function iterationsOrDefault(value: string) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : ITERATIONS;
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function isHashed(value: string): boolean {
  return value.startsWith("scrypt$");
}

import crypto from 'node:crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

/**
 * Hashes passwords using memory-hard scrypt (64-byte key, 16-byte random salt)
 * with constant-time verification via crypto.timingSafeEqual.
 */
export function hashPassword(plaintext: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto
    .scryptSync(plaintext, salt, KEY_LENGTH, SCRYPT_PARAMS)
    .toString('hex');
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt}$${derived}`;
}

export function verifyPassword(plaintext: string, storedHash: string): boolean {
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = parts[4];
    const expectedHex = parts[5];

    const derived = crypto.scryptSync(plaintext, salt, KEY_LENGTH, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(derived, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Hashes one-time verification codes (teacher check-in challenges, MFA codes, password reset tokens)
 * using HMAC-SHA256 with a server-side secret + challenge-specific salt so secrets are never stored in plaintext.
 */
export function hashVerificationSecret(code: string, challengeSalt: string): string {
  const secret = process.env.SESSION_SECRET || 'ims-dev-verification-hmac-key-2026';
  return crypto
    .createHmac('sha256', `${secret}:${challengeSalt}`)
    .update(code.trim().toUpperCase())
    .digest('hex');
}

export function verifyVerificationSecret(
  code: string,
  challengeSalt: string,
  expectedHashHex: string
): boolean {
  const candidateHex = hashVerificationSecret(code, challengeSalt);
  const a = Buffer.from(candidateHex, 'hex');
  const b = Buffer.from(expectedHashHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Generates a human-enterable 6-character alphanumeric verification challenge code
 * excluding ambiguous characters (0, O, 1, I).
 */
export function generateReadableChallengeCode(length = 6): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

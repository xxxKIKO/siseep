import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random token (256 bits by default). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest. Used to store tokens: they have enough entropy to not need a slow hash. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

/** "K7MP-3QXH-9R": temporary password from the unambiguous alphabet (no 0/O/1/I/L). */
export function temporaryPassword(alphabet: string): string {
  const chars = Array.from(randomBytes(10), (byte) => alphabet[byte % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

import { createHash, timingSafeEqual } from 'crypto';

/**
 * Fail-closed, constant-time API-key verification for protected routes.
 *
 * Security model (see inspection finding D4-1):
 *  - The previous implementation treated ANY non-null `x-api-key` header as a
 *    valid credential, and no `QUANTAN_API_KEY` was ever defined to compare
 *    against. That is an auth bypass that allows unauthenticated LLM-credit burn.
 *
 *  - This helper is FAIL-CLOSED: if the server has no configured secret
 *    (`QUANTAN_API_KEY` unset/empty), every presented key is rejected. A missing
 *    server secret can never authenticate a caller.
 *
 *  - When a secret IS configured, the presented key is compared to it in
 *    constant time. We hash both sides to a fixed 32-byte SHA-256 digest before
 *    calling `crypto.timingSafeEqual`. This is important because
 *    `timingSafeEqual` THROWS on length mismatch — comparing raw buffers of
 *    attacker-controlled length would turn a short probe key into a 500 instead
 *    of a clean rejection, and could leak length via timing. Hashing to a fixed
 *    width sidesteps both problems while preserving constant-time comparison.
 *
 * This function never logs the secret or the presented key.
 */
export function isValidApiKey(presented: string | null | undefined): boolean {
  const expected = process.env.QUANTAN_API_KEY;

  // Fail-closed: no server secret => nothing can authenticate via API key.
  if (!expected) return false;

  // No (or empty) presented key => reject.
  if (!presented) return false;

  // Constant-time compare over fixed-width digests (avoids the length-mismatch
  // throw in timingSafeEqual and avoids leaking length via timing).
  const a = sha256(presented);
  const b = sha256(expected);
  return timingSafeEqual(a, b);
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

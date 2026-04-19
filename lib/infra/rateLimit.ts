/**
 * Best-effort in-memory rate limit for serverless routes (per-instance).
 * For production abuse protection, prefer edge / Redis limits.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

export function rateLimitHit(key: string, maxPerWindow: number, windowMs: number): boolean {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  b.count++
  if (b.count > maxPerWindow) return true
  return false
}

export function clientKeyFromRequest(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]?.trim() || 'unknown'
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return 'local'
}

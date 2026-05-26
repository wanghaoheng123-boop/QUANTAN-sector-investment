/**
 * Rate limiter for Next.js API routes (Phase 15 Q-005).
 *
 * Default: in-memory token bucket per serverless instance.
 * When KV_REST_API_URL + KV_REST_API_TOKEN are set (Vercel KV / Upstash),
 * uses distributed INCR+EXPIRE; falls back to memory on KV errors.
 */

const buckets = new Map<string, { tokens: number; lastRefill: number }>()

const STALE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const MAX_BUCKETS = 50_000
let _lastCleanup = Date.now()

function cleanupStale() {
  const now = Date.now()
  if (now - _lastCleanup < STALE_CLEANUP_INTERVAL_MS) return
  _lastCleanup = now
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > 15 * 60 * 1000) buckets.delete(key)
  }
}

function evictHalfByAge(): void {
  const sorted = [...buckets.entries()].sort((a, b) => a[1].lastRefill - b[1].lastRefill)
  const dropCount = Math.floor(sorted.length / 2)
  for (let i = 0; i < dropCount; i++) buckets.delete(sorted[i][0])
}

export interface RateLimitConfig {
  maxRequests: number
  windowSeconds: number
}

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): { allowed: true } | { allowed: false; retryAfter: number } {
  return checkRateLimitMemory(key, config)
}

function checkRateLimitMemory(
  key: string,
  config: RateLimitConfig,
): { allowed: true } | { allowed: false; retryAfter: number } {
  cleanupStale()
  const now = Date.now()
  const refillRate = config.maxRequests / config.windowSeconds
  let bucket = buckets.get(key)
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) evictHalfByAge()
    bucket = { tokens: config.maxRequests, lastRefill: now }
    buckets.set(key, bucket)
  }
  const elapsedSec = Math.max(0, (now - bucket.lastRefill) / 1000)
  bucket.tokens = Math.min(config.maxRequests, bucket.tokens + elapsedSec * refillRate)
  bucket.lastRefill = now
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return { allowed: true }
  }
  const retryAfter = Math.ceil((1 - bucket.tokens) / refillRate)
  return { allowed: false, retryAfter: Math.max(1, retryAfter) }
}

function isKvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

async function checkRateLimitKv(
  key: string,
  config: RateLimitConfig,
): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  const base = process.env.KV_REST_API_URL!.replace(/\/$/, '')
  const auth = { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN!}` }
  const bucketKey = `rl:${key}`
  try {
    const incrRes = await fetch(`${base}/incr/${encodeURIComponent(bucketKey)}`, { headers: auth })
    if (!incrRes.ok) return checkRateLimitMemory(key, config)
    const body = (await incrRes.json()) as { result?: number }
    const count = Number(body.result ?? 1)
    if (count === 1) {
      await fetch(`${base}/expire/${encodeURIComponent(bucketKey)}/${config.windowSeconds}`, { headers: auth })
    }
    if (count <= config.maxRequests) return { allowed: true }
    return { allowed: false, retryAfter: Math.max(1, config.windowSeconds) }
  } catch {
    return checkRateLimitMemory(key, config)
  }
}

export function getRateLimitKey(request: Request, routeName: string): string {
  const isVercel = process.env.VERCEL === '1'
  let ip: string
  if (isVercel) {
    ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'
  } else {
    ip = request.headers.get('x-real-ip') || 'server'
  }
  return `${routeName}:${ip}`
}

export async function applyRateLimit(
  request: Request,
  routeName: string,
  config: RateLimitConfig,
): Promise<Response | null> {
  const key = getRateLimitKey(request, routeName)
  const result = isKvConfigured()
    ? await checkRateLimitKv(key, config)
    : checkRateLimitMemory(key, config)
  if (!result.allowed) {
    return new Response(
      JSON.stringify({
        error: 'rate_limited',
        message: `Too many requests. Try again in ${result.retryAfter} second(s).`,
        retryAfter: result.retryAfter,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(result.retryAfter),
        },
      },
    )
  }
  return null
}

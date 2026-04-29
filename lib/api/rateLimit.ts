/**
 * In-memory token-bucket rate limiter for Next.js API routes.
 *
 * Each route gets a bucket identified by a composite key (route name + IP).
 * Buckets refill tokens at the configured rate. When a bucket is empty, the
 * request is rejected with 429 Too Many Requests.
 *
 * All state is per-process (serverless instance). In a multi-instance Vercel
 * deployment this provides approximate per-instance limiting — for strict global
 * limits, use an external store (Redis, Upstash, Vercel KV).
 */

const buckets = new Map<string, { tokens: number; lastRefill: number }>()

// Purge stale entries every 5 minutes to prevent memory leak from abandoned IPs.
const STALE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
let _lastCleanup = Date.now()

function cleanupStale() {
  const now = Date.now()
  if (now - _lastCleanup < STALE_CLEANUP_INTERVAL_MS) return
  _lastCleanup = now
  for (const [key, bucket] of buckets) {
    // Buckets that haven't been accessed in > 15 min are stale
    if (now - bucket.lastRefill > 15 * 60 * 1000) {
      buckets.delete(key)
    }
  }
}

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window. */
  maxRequests: number
  /** Window size in seconds over which maxRequests is measured. */
  windowSeconds: number
}

/**
 * Check rate limit for a given key. Returns { allowed: true } or
 * { allowed: false, retryAfter: seconds }.
 *
 * The token bucket refills at a rate of maxRequests / windowSeconds tokens per
 * second, with a burst capacity of maxRequests.
 */
export function checkRateLimit(
  /** Composite key — typically `${routeName}:${ip}` */
  key: string,
  config: RateLimitConfig
): { allowed: true } | { allowed: false; retryAfter: number } {
  cleanupStale()

  const now = Date.now()
  const refillRate = config.maxRequests / config.windowSeconds // tokens per second
  const bucketKey = key

  let bucket = buckets.get(bucketKey)
  if (!bucket) {
    bucket = { tokens: config.maxRequests, lastRefill: now }
    buckets.set(bucketKey, bucket)
  }

  // Refill tokens based on elapsed time
  const elapsedSec = (now - bucket.lastRefill) / 1000
  const refillTokens = elapsedSec * refillRate
  bucket.tokens = Math.min(config.maxRequests, bucket.tokens + refillTokens)
  bucket.lastRefill = now

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return { allowed: true }
  }

  // Calculate how long until the next token is available
  const tokensNeeded = 1 - bucket.tokens
  const retryAfter = Math.ceil(tokensNeeded / refillRate)
  return { allowed: false, retryAfter: Math.max(1, retryAfter) }
}

/**
 * Extract a rate-limit key from a NextRequest. Uses x-forwarded-for header
 * (trusted in Vercel deployments) with a fallback to x-real-ip or a hash of
 * the request's properties.
 */
export function getRateLimitKey(request: Request, routeName: string): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
  return `${routeName}:${ip}`
}

/**
 * Convenience: apply rate limiting to a request and return a 429 response if
 * exceeded, or null if the request should proceed.
 */
export function applyRateLimit(
  request: Request,
  routeName: string,
  config: RateLimitConfig
): Response | null {
  const key = getRateLimitKey(request, routeName)
  const result = checkRateLimit(key, config)
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
      }
    )
  }
  return null
}

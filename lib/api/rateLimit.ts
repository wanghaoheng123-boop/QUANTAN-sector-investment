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
// Hard cap on bucket-map size. Without this, an attacker spoofing
// x-forwarded-for with a fresh IP per request grows the map unboundedly
// between cleanup ticks (5 min × even modest req-rate = hundreds of
// thousands of entries). When the cap is reached we evict the oldest
// half by lastRefill — degrades gracefully to global limiting under
// attack instead of OOMing the serverless instance.
const MAX_BUCKETS = 50_000
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

/**
 * Emergency eviction when bucket-map size exceeds MAX_BUCKETS. Sorts the
 * entries by lastRefill ascending (oldest first) and removes the older
 * half. Runs O(n log n) so we don't call it unless absolutely needed.
 */
function evictHalfByAge(): void {
  const sorted = [...buckets.entries()].sort((a, b) => a[1].lastRefill - b[1].lastRefill)
  const dropCount = Math.floor(sorted.length / 2)
  for (let i = 0; i < dropCount; i++) {
    buckets.delete(sorted[i][0])
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
    // Enforce memory ceiling before adding a new bucket. Without this,
    // an attacker spoofing fresh IPs every request can OOM the function.
    if (buckets.size >= MAX_BUCKETS) {
      evictHalfByAge()
    }
    bucket = { tokens: config.maxRequests, lastRefill: now }
    buckets.set(bucketKey, bucket)
  }

  // Refill tokens based on elapsed time. Clamp elapsed to 0 — if the
  // system clock skews backward (NTP adjustment, manual override), a
  // raw subtraction yields negative refillTokens, which silently
  // REDUCES bucket capacity instead of refilling it. Tokens monotonic
  // up to maxRequests is the correct semantic.
  const elapsedSec = Math.max(0, (now - bucket.lastRefill) / 1000)
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

import { NextResponse, type NextRequest } from 'next/server'
import { fetchMlPrediction, isMlSidecarAvailable } from '@/lib/ml/client'
import { normalizeTicker, sanitizeError } from '@/lib/api/sanitize'
import { applyRateLimit } from '@/lib/api/rateLimit'

/**
 * ML prediction proxy to the Python sidecar.
 *
 * Phase 13 S2 hardening:
 *   - F7.3: strict ticker validation via normalizeTicker (was permissive
 *     yahooSymbolFromParam — accepted any string, SSRF risk via the
 *     forward to the sidecar URL).
 *   - F4.3-related: 30 req/min/IP rate limit so a hostile client cannot
 *     DoS the sidecar by spamming ML predictions (the sidecar is a
 *     much heavier code path than typical Yahoo proxy routes).
 *   - F7.2 / CWE-209: error messages stripped in production via
 *     sanitizeError. The previous implementation echoed `error.message`
 *     unconditionally, leaking stack-related context (sidecar URL,
 *     internal hostnames) to any client triggering an error.
 */
export async function GET(request: NextRequest, { params }: { params: { ticker: string } }) {
  // Rate limit — 30 req/min/IP. ML predictions are expensive (model
  // inference); even a small attack can saturate the sidecar.
  const rateLimitResponse = await applyRateLimit(request, 'ml-prediction', { maxRequests: 30, windowSeconds: 60 })
  if (rateLimitResponse) return rateLimitResponse

  // Strict ticker validation. normalizeTicker returns null for any
  // characters outside the allowed set (uppercase letters/digits + . - = ^),
  // length-bounded, and forces US-index prefixing where applicable.
  const symbol = normalizeTicker(params.ticker)
  if (!symbol) {
    return NextResponse.json(
      { available: false, error: 'invalid_ticker' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  try {
    const available = await isMlSidecarAvailable()
    if (!available) {
      return NextResponse.json({ available: false, symbol })
    }

    const prediction = await fetchMlPrediction(symbol)
    if (!prediction) {
      return NextResponse.json({ available: false, symbol })
    }

    return NextResponse.json({ available: true, ...prediction })
  } catch (error) {
    // Log full error server-side; return sanitized payload to client.
    console.error('[ML API] Error fetching prediction:', error)
    return NextResponse.json(
      {
        available: false,
        error: 'ml_prediction_failed',
        details: sanitizeError(error), // undefined in production
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}

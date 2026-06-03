import { NextResponse } from 'next/server'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { resolveTradingAgentsBase } from '@/lib/trading-agents-config'
import { sanitizeError } from '@/lib/api/sanitize'

// Phase 14 wave 22 (R7-HIGH): the sibling [ticker]/route.ts explicitly avoids
// echoing TA_BASE in responses ("Do NOT echo TA_BASE — it may include a
// private Railway URL"). This health endpoint previously emitted `base` in
// every JSON response to UNAUTHENTICATED callers, defeating that protection
// and exposing the private upstream URL for enumeration ("which Railway
// deploys are alive for this Vercel project?"). The error catch also
// returned raw `String(err)` — unsanitized error → potential stack-trace leak.
//
// Fix: only echo `base` in non-production, and route all error details
// through `sanitizeError`.
const isProd = process.env.NODE_ENV === 'production'

export async function GET(request: Request) {
  const rateLimitResponse = await applyRateLimit(request, 'trading-agents-health', {
    maxRequests: 30,
    windowSeconds: 60,
  })
  if (rateLimitResponse) return rateLimitResponse

  const resolved = resolveTradingAgentsBase()
  if (!resolved.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: 'config_error',
        error: resolved.reason === 'missing' ? 'backend_not_configured' : 'invalid_trading_agents_base',
        details: resolved.reason,
      },
      { status: 200 }
    )
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const r = await fetch(`${resolved.base}/health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    clearTimeout(timer)
    if (!r.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: 'unreachable',
          source: resolved.source,
          ...(isProd ? {} : { base: resolved.base }),
          error: 'backend_unreachable',
          details: `health returned ${r.status}`,
        },
        { status: 200 }
      )
    }
    return NextResponse.json(
      {
        ok: true,
        status: 'ready',
        source: resolved.source,
        ...(isProd ? {} : { base: resolved.base }),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        status: 'unreachable',
        source: resolved.source,
        ...(isProd ? {} : { base: resolved.base }),
        error: 'backend_unreachable',
        // Phase 14 wave 22: previously `String(err)` (unsanitized) — could
        // leak stack traces / internal hostnames. Now goes through the
        // shared sanitizeError pattern.
        details: sanitizeError(err) ?? 'fetch_failed',
      },
      { status: 200 }
    )
  }
}

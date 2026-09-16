import { NextResponse } from 'next/server'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { isValidApiKey } from '@/lib/auth/apiKey'
import { bridgeHealthCheck, bloombergBridgeState } from '@/lib/data/bloomberg/bridgeClient'

export const runtime = 'nodejs'

/** Bridge diagnostics are restricted to holders of the server's shared API key. */
export async function GET(request: Request) {
  // Authenticate before the limiter: its Redis backend can itself make outbound
  // requests. A public probe gets the same response regardless of bridge state.
  // Ordinary OAuth sessions do not imply permission to inspect infrastructure.
  if (!isValidApiKey(request.headers.get('x-api-key'))) {
    return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const rateLimitResponse = await applyRateLimit(request, 'bloomberg-bridge-health', {
    maxRequests: 30,
    windowSeconds: 60,
  })
  if (rateLimitResponse) {
    rateLimitResponse.headers.set('Cache-Control', 'no-store')
    return rateLimitResponse
  }

  const state = bloombergBridgeState()
  if (state !== 'enabled') {
    return NextResponse.json({ status: 'ok', state }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const h = await bridgeHealthCheck()
  return NextResponse.json({
    status: 'ok',
    state,
    reachable: h.ok,
    latencyMs: h.latencyMs,
    error: h.error,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

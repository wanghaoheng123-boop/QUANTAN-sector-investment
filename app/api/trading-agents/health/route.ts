import { NextResponse } from 'next/server'
import { resolveTradingAgentsBase } from '@/lib/trading-agents-config'

export async function GET() {
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
          base: resolved.base,
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
        base: resolved.base,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        status: 'unreachable',
        source: resolved.source,
        base: resolved.base,
        error: 'backend_unreachable',
        details: String(err),
      },
      { status: 200 }
    )
  }
}

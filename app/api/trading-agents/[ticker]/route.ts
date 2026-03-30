import { NextRequest, NextResponse } from 'next/server'
import { SUPPORTED_PROVIDERS, DEFAULT_MODELS, type LLMProvider } from '@/lib/trading-agents-config'

// TradingAgents backend URL — set TRADING_AGENTS_BASE env var to your deployed Railway/Render URL.
// In production (Vercel) we no longer fall back to 127.0.0.1 (which was unreachable).
const TA_BASE = process.env.TRADING_AGENTS_BASE

const TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes — TradingAgents can be slow

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker?.trim().toUpperCase()
  if (!ticker) {
    return NextResponse.json({ error: 'ticker is required' }, { status: 400 })
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const url = `${TA_BASE}/analyze/${encodeURIComponent(ticker)}/latest`
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })

    clearTimeout(timer)

    if (res.status === 404) {
      return NextResponse.json(
        {
          error: 'no_cached_analysis',
          message: `No analysis found for ${ticker}. POST /api/trading-agents/${ticker} to run one.`,
        },
        { status: 404 }
      )
    }

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json(
        { error: 'upstream_error', details: text },
        { status: 502 }
      )
    }

    const json = await res.json()
    return NextResponse.json(json, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return NextResponse.json(
        { error: 'analysis_timeout', message: 'TradingAgents took too long (>5 min)' },
        { status: 504 }
      )
    }
    const msg = String(err)
    // Detect connection refused / fetch failures (backend not reachable)
    const isConnectivityError =
      msg.includes('ECONNREFUSED') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('fetch failed') ||
      msg.includes('NetworkError') ||
      msg.includes('TypeError') ||
      !TA_BASE

    if (isConnectivityError) {
      return NextResponse.json(
        {
          error: 'backend_not_configured',
          message:
            'TradingAgents backend is not configured. ' +
            'Deploy server_trading_agents.py to Railway or Render, then set ' +
            'TRADING_AGENTS_BASE in Vercel Environment Variables. ' +
            'See: https://github.com/your-repo#llm-multi-agent-setup',
          details: TA_BASE ? msg : 'TRADING_AGENTS_BASE is not set',
        },
        { status: 502 }
      )
    }
    console.error('[TradingAgents GET]', err)
    return NextResponse.json(
      { error: 'failed_to_fetch', details: msg },
      { status: 502 }
    )
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker?.trim().toUpperCase()
  if (!ticker) {
    return NextResponse.json({ error: 'ticker is required' }, { status: 400 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body is fine
  }

  const provider = body.llm_provider as string | undefined
  const apiKey = body.api_key as string | undefined

  // Validate provider
  if (provider && !SUPPORTED_PROVIDERS.includes(provider as LLMProvider)) {
    return NextResponse.json(
      {
        error: 'invalid_provider',
        message: `Provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}`,
      },
      { status: 400 }
    )
  }

  // If user provides an api_key, a provider must also be specified
  if (apiKey && !provider) {
    return NextResponse.json(
      {
        error: 'provider_required_with_api_key',
        message: 'llm_provider is required when supplying api_key',
      },
      { status: 400 }
    )
  }

  // Basic api_key validation
  if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.trim().length < 8)) {
    return NextResponse.json(
      { error: 'invalid_api_key', message: 'api_key must be a valid non-empty string' },
      { status: 400 }
    )
  }

  // Sanitize: strip any top-level fields that shouldn't be forwarded
  const { api_key: _stripped, ..._clean } = body as Record<string, unknown>
  void _stripped

  // Build query params for the Python server
  const queryParams = new URLSearchParams()

  if (body.trade_date) queryParams.set('trade_date', String(body.trade_date))
  if (provider) queryParams.set('llm_provider', provider)

  const providerKey = provider as LLMProvider | undefined
  const defaults = providerKey ? DEFAULT_MODELS[providerKey] : null

  if (body.deep_think_llm) {
    queryParams.set('deep_think_llm', String(body.deep_think_llm))
  } else if (defaults) {
    queryParams.set('deep_think_llm', defaults.deep)
  }

  if (body.quick_think_llm) {
    queryParams.set('quick_think_llm', String(body.quick_think_llm))
  } else if (defaults) {
    queryParams.set('quick_think_llm', defaults.quick)
  }

  if (typeof body.max_debate_rounds === 'number') {
    queryParams.set('max_debate_rounds', String(body.max_debate_rounds))
  }

  if (typeof body.max_risk_discuss_rounds === 'number') {
    queryParams.set('max_risk_discuss_rounds', String(body.max_risk_discuss_rounds))
  }

  if (body.data_vendor) queryParams.set('data_vendor', String(body.data_vendor))

  const queryString = queryParams.toString()
  const url = `${TA_BASE}/analyze/${encodeURIComponent(ticker)}${queryString ? '?' + queryString : ''}`

  // Body sent to Python server — api_key only if user provided it
  const upstreamBody: Record<string, unknown> = {
    llm_provider: provider,
    deep_think_llm: queryParams.get('deep_think_llm'),
    quick_think_llm: queryParams.get('quick_think_llm'),
    max_debate_rounds: body.max_debate_rounds,
    max_risk_discuss_rounds: body.max_risk_discuss_rounds,
    data_vendor: body.data_vendor,
    trade_date: body.trade_date,
  }

  if (apiKey) {
    upstreamBody.api_key = apiKey
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const upstream = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(upstreamBody),
    })

    clearTimeout(timer)

    if (!upstream.ok) {
      let errorData: { error?: string; details?: string } = {}
      try {
        errorData = await upstream.json()
      } catch {
        // ignore parse error
      }
      return NextResponse.json(
        {
          error: 'upstream_error',
          details: errorData.details || errorData.error || upstream.statusText,
        },
        { status: 502 }
      )
    }

    const json = await upstream.json()
    return NextResponse.json(json, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return NextResponse.json(
        { error: 'analysis_timeout', message: 'TradingAgents took too long (>5 min)' },
        { status: 504 }
      )
    }
    const msg = String(err)
    const isConnectivityError =
      msg.includes('ECONNREFUSED') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('fetch failed') ||
      msg.includes('NetworkError') ||
      msg.includes('TypeError') ||
      !TA_BASE

    if (isConnectivityError) {
      return NextResponse.json(
        {
          error: 'backend_not_configured',
          message:
            'TradingAgents backend is not configured. ' +
            'Deploy server_trading_agents.py to Railway or Render, then set ' +
            'TRADING_AGENTS_BASE in Vercel Environment Variables. ' +
            'See: https://github.com/your-repo#llm-multi-agent-setup',
          details: TA_BASE ? msg : 'TRADING_AGENTS_BASE is not set',
        },
        { status: 502 }
      )
    }
    console.error('[TradingAgents POST]', err)
    return NextResponse.json(
      { error: 'failed_to_fetch', details: msg },
      { status: 502 }
    )
  }
}

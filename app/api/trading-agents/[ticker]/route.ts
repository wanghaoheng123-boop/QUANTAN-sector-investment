import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getAuthOptions } from '@/lib/auth'
import { SUPPORTED_PROVIDERS, DEFAULT_MODELS, type LLMProvider, resolveTradingAgentsBase, type TradingAgentsResolved } from '@/lib/trading-agents-config'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { normalizeTicker, sanitizeError } from '@/lib/api/sanitize'
import { validateCsrf } from '@/lib/api/csrf'
import { isValidApiKey } from '@/lib/auth/apiKey'

const TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes — TradingAgents can be slow
const TA_RATE_LIMIT = { maxRequests: 10, windowSeconds: 60 }

const DEPLOY_HINT =
  'Recommended: deploy `server_trading_agents.py` on Railway using the included Procfile, then set ' +
  '`TRADING_AGENTS_BASE` in Vercel to the public https:// URL (no trailing slash). See README: LLM Multi-Agent Analysis.'

function tradingAgentsConfigErrorResponse(resolved: Extract<TradingAgentsResolved, { ok: false }>) {
  if (resolved.reason === 'missing') {
    return NextResponse.json(
      {
        error: 'backend_not_configured',
        message:
          'TradingAgents backend is not configured for this deployment. Ask the site owner to set ' +
          'TRADING_AGENTS_BASE (or managed TRADING_AGENTS_FALLBACK_BASE), or self-host via Railway. ' +
          DEPLOY_HINT,
        details: 'TRADING_AGENTS_BASE / TRADING_AGENTS_FALLBACK_BASE are not set',
      },
      { status: 502 }
    )
  }
  if (resolved.reason === 'insecure_base') {
    return NextResponse.json(
      {
        error: 'invalid_trading_agents_base',
        message:
          'TRADING_AGENTS_BASE or TRADING_AGENTS_FALLBACK_BASE must use https:// in production so your API key is encrypted in transit. ' +
          'Use your Railway (or other host) public HTTPS URL, e.g. https://your-app.up.railway.app',
        details: 'http:// is not accepted when NODE_ENV=production',
      },
      { status: 502 }
    )
  }
  return NextResponse.json(
    {
      error: 'invalid_trading_agents_base',
      message:
        'TRADING_AGENTS_BASE/TRADING_AGENTS_FALLBACK_BASE is not a valid http(s) URL. Use the origin only, e.g. https://your-app.up.railway.app (no path, no credentials).',
      details: 'invalid_url',
    },
    { status: 502 }
  )
}

export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: tickerParam } = await params
  // Rate limit: 10 req/min per IP
  const rateLimitResponse = await applyRateLimit(req, 'trading-agents', TA_RATE_LIMIT)
  if (rateLimitResponse) return rateLimitResponse
  // Phase 13 S2 (F7.3): canonical ticker validation — rejects scripts/paths
  // before they reach the upstream Python service.
  const ticker = normalizeTicker(tickerParam || '')
  if (!ticker) {
    return NextResponse.json({ error: 'Invalid ticker symbol' }, { status: 400 })
  }

  const resolved = resolveTradingAgentsBase()
  if (!resolved.ok) {
    return tradingAgentsConfigErrorResponse(resolved)
  }
  const TA_BASE = resolved.base

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
      // Phase 13 S2 (F4.8): never forward raw upstream body to client — it
      // can contain Python tracebacks, internal paths, or third-party API
      // error envelopes with secrets.
      const text = await res.text().catch(() => '')
      console.warn('[trading-agents GET] upstream', res.status, text.slice(0, 200))
      const details = sanitizeError(text)
      return NextResponse.json(
        { error: 'upstream_error', status: res.status, ...(details ? { details } : {}) },
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
    // CWE-209: msg is used internally for connectivity-error detection only;
    // the response uses sanitizeError so production clients don't see
    // stack-related details (internal hostnames, file paths, etc).
    const msg = String(err)
    const isConnectivityError =
      msg.includes('ECONNREFUSED') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('fetch failed') ||
      msg.includes('NetworkError') ||
      msg.includes('TypeError')

    if (isConnectivityError) {
      return NextResponse.json(
        {
          error: 'backend_unreachable',
          // Do NOT echo TA_BASE — it may include a private Railway URL.
          // Surface a generic message; full URL only in dev via sanitizeError.
          message: `Cannot reach TradingAgents backend. ${DEPLOY_HINT}`,
          details: sanitizeError(err),
        },
        { status: 502 }
      )
    }
    console.error('[TradingAgents GET]', err)
    return NextResponse.json(
      { error: 'failed_to_fetch', details: sanitizeError(err) },
      { status: 502 }
    )
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  // Phase 15 Q-055-NEW: CSRF guard before any other work. The double-submit
  // pattern (cookie + matching x-quantan-csrf header) ensures the request
  // came from a same-origin context. Cookie is issued by middleware.ts on
  // first page load; client must read it and echo it in the header.
  //
  // Allow X-API-Key callers to bypass CSRF — they're server-to-server, not
  // browser-initiated, and use a different authentication discipline (the API
  // key itself proves origin authority). CSRF is browser-session protection;
  // out-of-band API integrations are out of scope.
  //
  // D4-1 (inspection 2026-05-30): the bypass MUST require a *valid* key, not
  // merely a present header. Previously any non-null x-api-key satisfied this
  // check (and the auth check below) with no QUANTAN_API_KEY to validate
  // against — an auth bypass allowing unauthenticated LLM-credit burn.
  // isValidApiKey() is fail-closed (rejects when QUANTAN_API_KEY is unset) and
  // compares in constant time. See lib/auth/apiKey.ts.
  const apiKeyHeader = req.headers.get('x-api-key')
  const apiKeyValid = isValidApiKey(apiKeyHeader)
  if (!apiKeyValid && !validateCsrf(req)) {
    return NextResponse.json(
      { error: 'csrf_invalid', message: 'Missing or invalid CSRF token. Reload the page and retry.' },
      { status: 403 },
    )
  }

  // Rate limit: 10 req/min per IP
  const rateLimitResponse = await applyRateLimit(req, 'trading-agents', TA_RATE_LIMIT)
  if (rateLimitResponse) return rateLimitResponse

  // Auth check: require a valid session OR a VALID X-API-Key (constant-time
  // match vs configured QUANTAN_API_KEY; fail-closed when that env is unset).
  const session = await getServerSession(getAuthOptions())
  if (!session?.user && !apiKeyValid) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Authentication required. Sign in or provide a valid X-API-Key header.' },
      { status: 401 }
    )
  }

  const { ticker: tickerParam } = await params
  const ticker = normalizeTicker(tickerParam || '')
  if (!ticker) {
    return NextResponse.json({ error: 'Invalid ticker symbol' }, { status: 400 })
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

  const resolved = resolveTradingAgentsBase()
  if (!resolved.ok) {
    return tradingAgentsConfigErrorResponse(resolved)
  }
  const TA_BASE = resolved.base

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

  // Phase 14 wave 22 (R7-MED): clamp debate / risk-discuss rounds to a sane
  // range. Previously these were forwarded verbatim with only `typeof number`.
  // The Python sidecar honours whatever value we pass; a hostile client could
  // request 1,000,000 rounds and burn CPU + LLM-API credits before the 5-minute
  // TIMEOUT_MS triggered. Per-IP rate-limit (10/min) still allows expensive
  // sustained abuse without this clamp.
  //
  // Sensible bounds based on the upstream model: 1-5 rounds. Reject NaN /
  // non-integer / out-of-range with silent fallback to default.
  const clampRound = (v: unknown): number | null => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    const i = Math.floor(v)
    if (i < 1 || i > 5) return null
    return i
  }
  const mdr = clampRound(body.max_debate_rounds)
  if (mdr !== null) queryParams.set('max_debate_rounds', String(mdr))
  const mrd = clampRound(body.max_risk_discuss_rounds)
  if (mrd !== null) queryParams.set('max_risk_discuss_rounds', String(mrd))

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
      let errorData: { error?: string; details?: string; message?: string } = {}
      try {
        errorData = await upstream.json()
      } catch {
        // ignore parse error
      }
      // CWE-209: never forward upstream `details`/`message` verbatim — the
      // Python server may include traceback fragments, file paths, or
      // third-party API error envelopes carrying provider-side secrets. In
      // production return a generic message + sanitized status; preserve
      // upstream `error` code (a short string identifier — safe).
      const upstreamErrCode = typeof errorData.error === 'string' ? errorData.error : 'upstream_error'
      const isDev = process.env.NODE_ENV !== 'production'
      const detailText = isDev
        ? (errorData.details || errorData.message || errorData.error || upstream.statusText)
        : undefined
      return NextResponse.json(
        {
          error: 'upstream_error',
          upstreamErrorCode: upstreamErrCode,
          status: upstream.status,
          message: `Upstream returned ${upstream.status} — see server logs for details.`,
          details: detailText,
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
      msg.includes('TypeError')

    if (isConnectivityError) {
      return NextResponse.json(
        {
          error: 'backend_unreachable',
          // Do NOT echo TA_BASE — may include a private Railway URL.
          message: `Cannot reach TradingAgents backend. ${DEPLOY_HINT}`,
          details: sanitizeError(err),
        },
        { status: 502 }
      )
    }
    console.error('[TradingAgents POST]', err)
    return NextResponse.json(
      { error: 'failed_to_fetch', details: sanitizeError(err) },
      { status: 502 }
    )
  }
}

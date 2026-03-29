import { NextRequest, NextResponse } from 'next/server'

const TA_BASE =
  process.env.TRADING_AGENTS_BASE ||
  (process.env.NODE_ENV === 'production'
    ? 'http://127.0.0.1:3001'
    : 'http://127.0.0.1:3001')

const TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes — TradingAgents can be slow

export const runtime = 'nodejs'

// Supported providers and models
export const SUPPORTED_PROVIDERS = [
  'openai',
  'google',
  'anthropic',
  'xai',
  'openrouter',
  'ollama',
] as const

export type LLMProvider = (typeof SUPPORTED_PROVIDERS)[number]

// Default models per provider
export const DEFAULT_MODELS: Record<LLMProvider, { deep: string; quick: string }> = {
  openai:    { deep: 'gpt-4o',        quick: 'gpt-4o-mini' },
  google:    { deep: 'gemini-2.0-flash', quick: 'gemini-1.5-flash' },
  anthropic: { deep: 'claude-sonnet-4-20250514', quick: 'claude-3-5-haiku-20241022' },
  xai:       { deep: 'grok-3',        quick: 'grok-3-mini' },
  openrouter: { deep: 'anthropic/claude-sonnet-4', quick: 'anthropic/claude-3-5-haiku' },
  ollama:    { deep: 'llama3',        quick: 'llama3' },
}

// Provider display names
export const PROVIDER_LABELS: Record<LLMProvider, string> = {
  openai:    'OpenAI (GPT)',
  google:    'Google (Gemini)',
  anthropic: 'Anthropic (Claude)',
  xai:       'xAI (Grok)',
  openrouter: 'OpenRouter',
  ollama:    'Ollama (Local)',
}

// OpenAI-compatible base URLs for third-party providers
const PROVIDER_BASE_URLS: Partial<Record<LLMProvider, string>> = {
  openrouter: 'https://openrouter.ai/api/v1',
  ollama:     'http://localhost:11434/v1',
}

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
    console.error('[TradingAgents GET]', err)
    return NextResponse.json(
      { error: 'failed_to_fetch', details: String(err) },
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

  // Validate api_key format (basic check — just ensure it's a non-empty string)
  if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.trim().length < 8)) {
    return NextResponse.json(
      { error: 'invalid_api_key', message: 'api_key must be a valid non-empty string' },
      { status: 400 }
    )
  }

  // Sanitize: remove any keys that shouldn't be forwarded
  const {
    api_key: _stripped,
    ...optionsWithoutKey
  } = body as Record<string, unknown>

  // Build query params for the Python server
  const queryParams = new URLSearchParams()

  if (body.trade_date) queryParams.set('trade_date', String(body.trade_date))

  if (provider) queryParams.set('llm_provider', provider)

  if (body.deep_think_llm) {
    queryParams.set('deep_think_llm', String(body.deep_think_llm))
  } else if (provider) {
    // Default to the provider's standard deep model
    const defaults = DEFAULT_MODELS[provider as LLMProvider]
    if (defaults) queryParams.set('deep_think_llm', defaults.deep)
  }

  if (body.quick_think_llm) {
    queryParams.set('quick_think_llm', String(body.quick_think_llm))
  } else if (provider) {
    const defaults = DEFAULT_MODELS[provider as LLMProvider]
    if (defaults) queryParams.set('quick_think_llm', defaults.quick)
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

  // Build the body sent to Python server — includes api_key, excludes params sent as query
  const upstreamBody: Record<string, unknown> = {
    llm_provider: provider,
    deep_think_llm: queryParams.get('deep_think_llm'),
    quick_think_llm: queryParams.get('quick_think_llm'),
    max_debate_rounds: body.max_debate_rounds,
    max_risk_discuss_rounds: body.max_risk_discuss_rounds,
    data_vendor: body.data_vendor,
    trade_date: body.trade_date,
  }

  // Only include api_key if the user provided it — never use a server-side default
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
    console.error('[TradingAgents POST]', err)
    return NextResponse.json(
      { error: 'failed_to_fetch', details: String(err) },
      { status: 502 }
    )
  }
}

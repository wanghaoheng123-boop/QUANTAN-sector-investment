// Shared config for TradingAgents — used by both the API route and UI components.
// This file is NOT a route file, so it can export arbitrary values.
// IMPORTANT: Do NOT import next/server here — this file is also imported by client components.

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
  openai:    { deep: 'gpt-4o',         quick: 'gpt-4o-mini' },
  google:    { deep: 'gemini-2.0-flash', quick: 'gemini-1.5-flash' },
  anthropic: { deep: 'claude-sonnet-4-20250514', quick: 'claude-3-5-haiku-20241022' },
  xai:       { deep: 'grok-3',          quick: 'grok-3-mini' },
  openrouter: { deep: 'anthropic/claude-sonnet-4', quick: 'anthropic/claude-3-5-haiku' },
  ollama:    { deep: 'llama3',          quick: 'llama3' },
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

// ─── TradingAgents backend resolution (shared by [ticker] and health routes) ───

export type TradingAgentsResolved =
  | { ok: true; base: string; source: 'project' | 'managed_fallback' | 'local_dev' }
  | { ok: false; reason: 'missing' | 'invalid_url' | 'insecure_base' }

/**
 * Prefer TRADING_AGENTS_BASE (validated). Local dev falls back to localhost.
 * Production requires https:// to protect API keys in transit to your backend.
 */
export function resolveTradingAgentsBase(): TradingAgentsResolved {
  const parseBase = (
    raw: string | undefined,
    source: 'project' | 'managed_fallback'
  ): TradingAgentsResolved => {
    if (!raw?.trim()) return { ok: false, reason: 'missing' }
    const normalized = raw.trim().replace(/\/$/, '')
    let u: URL
    try {
      u = new URL(normalized)
    } catch {
      return { ok: false, reason: 'invalid_url' }
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, reason: 'invalid_url' }
    }
    if (u.username || u.password) {
      return { ok: false, reason: 'invalid_url' }
    }
    const base = u.origin
    if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') {
      return { ok: false, reason: 'insecure_base' }
    }
    return { ok: true, base, source }
  }

  const primary = parseBase(process.env.TRADING_AGENTS_BASE, 'project')
  if (primary.ok) return primary
  if (primary.reason !== 'missing') return primary

  const fallback = parseBase(process.env.TRADING_AGENTS_FALLBACK_BASE, 'managed_fallback')
  if (fallback.ok) return fallback
  if (fallback.reason !== 'missing') return fallback

  if (process.env.NODE_ENV === 'development') {
    return { ok: true, base: 'http://127.0.0.1:3001', source: 'local_dev' }
  }

  return { ok: false, reason: 'missing' }
}

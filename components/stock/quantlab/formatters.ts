import { formatPercent } from '@/lib/format'

export function fmtB(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toFixed(2)
}

export function fmtPct(n: number | null | undefined) {
  // SSOT: lib/format.formatPercent (2 decimals, unsigned).
  return formatPercent(n, 2)
}

export function isLlmConnectivityCode(code: string | null): boolean {
  if (!code) return false
  return [
    'backend_not_configured',
    'backend_unreachable',
    'failed_to_fetch',
    'analysis_timeout',
    'network_error',
    'parse_error',
    'invalid_trading_agents_base',
  ].includes(code)
}

export function isLlmProviderAuthFailure(code: string | null, message: string): boolean {
  if (code === 'invalid_api_key' || code === 'provider_required_with_api_key') return true
  if (code !== 'upstream_error') return false
  const m = message.toLowerCase()
  return (
    /\b401\b/.test(m) ||
    /\b403\b/.test(m) ||
    m.includes('unauthorized') ||
    m.includes('incorrect api key') ||
    m.includes('invalid api key') ||
    m.includes('invalid api_key') ||
    m.includes('authentication') ||
    (m.includes('api key') && (m.includes('invalid') || m.includes('incorrect')))
  )
}

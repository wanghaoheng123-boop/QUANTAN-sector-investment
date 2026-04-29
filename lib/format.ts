export function formatCurrency(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export function formatPercent(value: number | null | undefined, digits = 2, signed = false): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const sign = signed && value > 0 ? '+' : ''
  return `${sign}${(value * 100).toFixed(digits)}%`
}

export function formatSignedNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}`
}

export function formatCompactNumber(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: digits,
  }).format(value)
}

export function formatFreshness(iso: string | null | undefined): string {
  if (!iso) return 'stale'
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return 'stale'
  const deltaSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (deltaSec < 30) return 'live'
  if (deltaSec < 120) return `${deltaSec}s ago`
  const min = Math.floor(deltaSec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  return `${hr}h ago`
}

/**
 * Parse a Yahoo Finance quote timestamp into an ISO string.
 * Shared by darkpool and briefs API routes.
 */
export function parseQuoteTime(ts: unknown): string | null {
  if (ts == null) return null
  if (ts instanceof Date) return ts.toISOString()
  if (typeof ts === 'string') {
    const d = new Date(ts)
    return Number.isFinite(d.getTime()) ? d.toISOString() : null
  }
  if (typeof ts === 'number') {
    const ms = ts > 1e12 ? ts : ts * 1000
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
  }
  return null
}

/**
 * Safe numeric formatter — returns a placeholder for null / undefined /
 * NaN / ±Infinity instead of letting `.toFixed()` emit "NaN"/"Infinity"
 * or throwing on undefined.
 *
 * Phase 13 S2 cross-cutting Pattern 3 audit (defensive UI clamps):
 *   The codebase had local `safeToFixed` helpers in PriceTicker.tsx and
 *   ad-hoc `Number.isFinite(...) ? x.toFixed(d) : '—'` inline checks in
 *   many components. SSOT — every UI numeric render that originates
 *   from upstream data (quotes, signals, indicators) should pass through
 *   safeFixed so non-finite values render as a dash instead of breaking
 *   layout with "NaN%" / "$Infinity" / blank cells.
 *
 * Use formatCurrency / formatPercent / formatSignedNumber when the
 * specific semantic applies; use safeFixed for plain numeric display.
 */
export function safeFixed(
  value: number | null | undefined,
  digits = 2,
  fallback = '—',
): string {
  if (value == null || !Number.isFinite(value)) return fallback
  return value.toFixed(digits)
}

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

/**
 * Render a timestamp's age as a short human string.
 *
 * Q-101 (2026-09-13) — a missing timestamp returned the word `'stale'`, which
 * is a claim about the data's AGE made when the age is unknown. I2's wording is
 * the opposite: "Stale data displays as STALE with age. Missing data displays as
 * MISSING." Rendered on eight user-visible surfaces (SignalCard:161,
 * DarkPoolPanel:204, SectorRotationPanel:159, QuantLabPanel:65,
 * BtcQuantLab:409, sector:318, stock:385, backtest:181) with zero tests, and
 * three of those pass an explicitly-optional value. `formatCompactNumber`
 * directly above already returns '—' for the same case, so this was the odd one
 * out in its own file.
 *
 * NOT the same vocabulary as `DataFreshnessIndicator`, and that divergence is a
 * real finding rather than a tidy-up: this says "live" under 30s where the
 * component says 10s, and it knows nothing about caching, vendor delay or the
 * market session. Filed as Q-114 rather than unified here.
 */
export function formatFreshness(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return '—'
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
 *
 * Phase 14 wave 17: defensive bounds + try/catch around `.toISOString()`.
 * V8 throws RangeError when the date is outside ±100 million days from
 * the epoch (≈ year -271820 to year 275760). A negative or impossibly-large
 * timestamp from a misconfigured upstream would crash the route. We now
 * clamp to the V8 valid range and swallow the throw as a defensive
 * fallback.
 */
const MS_MAX = 8.64e15  // V8 max date: ±100 million days from epoch
const MS_MIN = -8.64e15

function safeToIso(ms: number): string | null {
  if (!Number.isFinite(ms)) return null
  if (ms < MS_MIN || ms > MS_MAX) return null
  try {
    return new Date(ms).toISOString()
  } catch {
    return null
  }
}

export function parseQuoteTime(ts: unknown): string | null {
  if (ts == null) return null
  if (ts instanceof Date) {
    const t = ts.getTime()
    return Number.isFinite(t) ? safeToIso(t) : null
  }
  if (typeof ts === 'string') {
    const d = new Date(ts)
    return Number.isFinite(d.getTime()) ? safeToIso(d.getTime()) : null
  }
  if (typeof ts === 'number') {
    const ms = ts > 1e12 ? ts : ts * 1000
    return safeToIso(ms)
  }
  return null
}

/**
 * Safe YYYY-MM-DD date formatter.
 *
 * Phase 14 wave 41 — SSOT for the common pattern in options components:
 *
 *   value instanceof Date ? value.toISOString().slice(0,10) : new Date(value).toISOString().slice(0,10)
 *
 * That ternary was duplicated in OptionsChainTable (twice) and was MISSING
 * entirely in FlowScanner — where the unconditional `item.expiration.toISOString()`
 * crashed the whole panel because after `fetch().then(r => r.json())` the
 * `expiration: Date` field is actually a string at runtime (Date is not
 * a JSON-native type — it serialises to a string).
 *
 * This helper accepts Date instances, ISO strings, or epoch numbers
 * (seconds or ms via the 1e12 heuristic) and returns YYYY-MM-DD. Invalid
 * input returns the supplied fallback (default empty string) — callers
 * can use that to render "—" or hide the cell entirely.
 *
 * Reference: HTML §4.10.6 Date inputs — YYYY-MM-DD is the canonical
 *            machine-readable form; sliced from ISO 8601.
 */
export function toIsoDate(value: unknown, fallback = ''): string {
  const iso = parseQuoteTime(value)
  if (iso == null) return fallback
  return iso.slice(0, 10)
}

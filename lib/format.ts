import { classifyFreshness, formatAge, type TradingCalendar } from '@/lib/data/freshness'
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
 * Short freshness phrase for inline display — ONE vocabulary, shared with
 * `DataFreshnessIndicator`.
 *
 * Q-114 (2026-09-24). This used to be a SECOND, independent age-to-label
 * mapping: it called anything under 30 seconds "live" where the component's
 * classifier says 10, and it knew nothing about caching, vendor delay or the
 * market session. Two vocabularies on overlapping surfaces meant the same datum
 * could read "live" here and "Stale" three inches away. It now delegates to
 * `classifyFreshness`, so there is exactly one set of thresholds and one
 * precedence order in the codebase.
 *
 * `stamp` IS THE PART THAT MATTERS, and it is not cosmetic. Half these call
 * sites pass a VENDOR quote time and half pass OUR OWN fetch/compute time:
 *
 *   vendor : quote.quoteTime            — when the exchange/vendor stamped it
 *   ours   : data.fetchedAt, computedAt — when WE last pulled or computed
 *
 * Only the first can be called "live". Saying "live" about our own fetch
 * recency describes our clock and claims the vendor's — the exact substitution
 * Q-101 found in three files and removed. So `stamp: 'ours'` renders "just now"
 * instead: true about what it measures, and silent about what it does not.
 *
 * Callers supply their own prefix ("Quote …", "Updated: …"), so this returns
 * the phrase alone.
 */
export function formatFreshness(
  iso: string | null | undefined,
  opts: {
    /** Whose clock wrote this timestamp. Defaults to the safer reading. */
    stamp?: 'vendor' | 'ours'
    cached?: boolean
    delayedMinutes?: number | null
    calendar?: TradingCalendar
    /** Injected in tests; real callers use the wall clock. */
    now?: number
  } = {},
): string {
  const { stamp = 'ours', cached = false, delayedMinutes = null, calendar = 'always-open', now = Date.now() } = opts
  if (!iso) return '—'
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return '—'

  const f = classifyFreshness({ quoteTime: ts, now, cached, delayedMinutes, calendar })
  switch (f.kind) {
    case 'unknown':
      return '—'
    case 'cached':
      return f.ageSec == null ? 'cached' : `cached · ${formatAge(f.ageSec)} ago`
    case 'delayed':
      return `delayed ${f.delayedMinutes}m`
    case 'atClose':
      return 'at close'
    case 'live':
      // The one place the two stamp kinds diverge, and the reason `stamp` exists.
      return stamp === 'vendor' ? 'live' : 'just now'
    default:
      return `${formatAge(f.ageSec as number)} ago`
  }
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

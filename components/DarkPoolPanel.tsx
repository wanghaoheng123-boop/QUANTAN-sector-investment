'use client'

import { LocalTime } from '@/components/LocalTime'
import { DarkPoolPrint } from '@/lib/sectors'
import type { DarkPoolAnalysis } from '@/lib/darkpool'
import { unwrapSynthetic, type Synthetic } from '@/lib/synthetic'
import { formatFreshness } from '@/lib/format'

// ─── Props ────────────────────────────────────────────────────────────────────

interface DarkPoolPanelProps {
  /**
   * Illustrative block prints — SYNTHETIC (design invariant I3, Q-088).
   *
   * The type is branded, so this prop can only be fed by
   * `generateDarkPoolPrints()`; real market data will not typecheck into it,
   * and conversely this value cannot be passed to a chart or signal prop.
   * There is no real per-print data source in the current stack — whether this
   * surface should exist at all is a product decision tracked as Q-089.
   */
  prints: Synthetic<DarkPoolPrint[]>
  ticker: string
  color: string
  /** Short interest and share counts loaded from /api/darkpool/[ticker] */
  apiData?: DarkPoolAnalysis | null
  /** True while fetching apiData */
  apiLoading?: boolean
  /** Q-140: the request itself failed (non-2xx or network); said, not hidden. */
  apiError?: string | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtShares(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toFixed(0)
}

function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—'
  return `${n.toFixed(decimals)}%`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DarkPoolPanel({
  prints: printsWrapped,
  ticker,
  color,
  apiData,
  apiLoading = false,
  apiError = null,
}: DarkPoolPanelProps) {
  // Runtime half of the I3 guard. This INSPECTS THE VALUE rather than taking a
  // caller-supplied boolean: if real data is ever rewired into this prop the
  // __SYNTHETIC__ marker is absent and this throws, which a hardcoded
  // `assert(true, …)` could never do.
  const prints = unwrapSynthetic(printsWrapped, 'DarkPoolPanel.prints')

  const metrics = apiData?.metrics
  const statusNote = apiData?.statusNote ?? null
  const shortPct = metrics?.shortFloatPct ?? null
  // Q-149: the sub-label names what is known, in the order a reader needs it.
  // A settlement date older than a missed reporting cycle says STALE with its
  // age (I2), rather than printing an old date as if it were current.
  const staleMark =
    metrics?.shortInterestStale && metrics.shortInterestAgeDays != null ? `STALE (${metrics.shortInterestAgeDays} days)` : null
  const shortSub = [
    metrics?.sharesShorted != null ? `${fmtShares(metrics.sharesShorted)} shares` : null,
    metrics?.shortInterestAsOf ? `as of ${metrics.shortInterestAsOf}` : null,
    staleMark,
  ].filter(Boolean).join(' · ') || 'not reported'
  // Q149-R2-10: Days to Cover is divided from the same settlement date as the
  // short count, so it is exactly as old. A mark on one card and not the other
  // would present half of one report as current.
  const daysToCoverSub = [
    'as reported by Yahoo; not computed from the volume shown',
    metrics?.daysToCover != null ? staleMark : null,
  ].filter(Boolean).join(' · ')
  // Q149-D2: a float the vendor reported and the route withheld is not "not reported".
  const floatWithheldSub =
    metrics?.floatWithheld === 'exceeds-shares-out'
      ? 'Float withheld: larger than shares outstanding'
      : metrics?.floatWithheld === 'inconsistent-with-short-interest'
        ? 'Float withheld: inconsistent with the short-interest figures'
        : null
  // Q149-R2-2: with the float withheld, the short % printed beside it is on the
  // vendor's own denominator, which for these names is often shares outstanding.
  const floatSub =
    metrics?.sharesFloat != null
      ? `Float ${fmtShares(metrics.sharesFloat)}`
      : floatWithheldSub != null
        ? shortPct != null
          ? `${floatWithheldSub} · short % is on Yahoo's own denominator`
          : floatWithheldSub
        : 'Float not reported'

  // ── Bullish print ratio (illustrative) ────────────────────────────────
  const bullishPrints = prints.filter((p) => p.sentiment === 'BULLISH')
  const totalPrintSize = prints.reduce((s, p) => s + p.size, 0)
  const bullishPct = totalPrintSize > 0
    ? (bullishPrints.reduce((s, p) => s + p.size, 0) / totalPrintSize) * 100
    : 50

  return (
    <div className="space-y-4">
      {/* ── Short interest and share counts (Yahoo) ───────────────────── */}
      {apiLoading && !apiData && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4 space-y-2 animate-pulse">
          <div className="h-4 bg-slate-800 rounded w-2/3" />
          <div className="h-3 bg-slate-800 rounded w-1/2" />
        </div>
      )}

      {apiError && !apiLoading && !apiData && (
        <div role="status" className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-3 text-xs text-amber-300">
          {apiError}
        </div>
      )}

      {apiData && !apiLoading && (
        <>
          {/* Status note when no real data. Q-140: a FAILED fetch (`degraded`) is
              styled as a failure, not as an informational note about coverage. */}
          {statusNote && (
            <div
              role={apiData.degraded ? 'status' : undefined}
              className={apiData.degraded
                ? 'rounded-xl border border-amber-800/40 bg-amber-950/20 p-3 text-xs text-amber-300 leading-relaxed'
                : 'rounded-xl border border-slate-700 bg-slate-900/40 p-3 text-xs text-slate-400 leading-relaxed'}
            >
              <span className="text-amber-300/80 font-semibold">{apiData.degraded ? 'Unavailable: ' : 'Note: '}</span>
              {statusNote}
            </div>
          )}

          {/* Q-149: this grid's first card was "Off-Exchange Vol", sub-labelled
              "Finra BATS", for a value no field supplied — it was "—" on every
              ticker. No data source here publishes off-exchange volume, so the
              panel says that once, instead of rendering an empty card that
              credits a venue. */}
          <p className="text-xs text-slate-400 leading-relaxed">
            Off-exchange (dark-pool) volume is not published by this data source. The figures below are
            short interest and share counts.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MetricCard label="Short Interest (% as reported)" value={fmtPct(shortPct, 2)} sub={shortSub} />
            <MetricCard
              label="Days to Cover"
              value={metrics?.daysToCover != null ? metrics.daysToCover.toFixed(1) : '—'}
              sub={daysToCoverSub}
            />
            <MetricCard label="10-Day Avg Volume" value={fmtShares(metrics?.avgDailyVolume)} sub="shares per day" />
            <MetricCard
              label="Shares Outstanding"
              value={fmtShares(metrics?.sharesOutstanding)}
              sub={floatSub}
            />
          </div>

          {/* Q-149: this was a "Short Interest Signal" banner — DISTRIBUTION above
              10% of float, ACCUMULATION below 5% — in red and green. Short
              interest does not say who is buying, the bands had no source, and
              the field was read 100× too small, so every stock (GME included)
              was labelled ACCUMULATION, and every ETF, which has no short
              interest figure at all, was told its short interest was
              "moderate". What the number is, stated plainly, replaces it. */}
          {shortPct != null && (
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Short interest is the number of shares sold short and not yet bought back, reported twice a
              month as of a settlement date. The percentage is Yahoo&apos;s own: its denominator is usually the
              float, but for some dual-class and ADR names it tracks shares outstanding. It is not a measure of
              off-exchange trading.
            </p>
          )}

          {/* Price */}
          {apiData.quote.price != null && apiData.quote.price > 0 && (
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>
                Last:{' '}
                <span className="text-white font-mono">
                  ${apiData.quote.price.toFixed(2)}
                </span>
              </span>
              {/* Phase 14 wave 22: defensive Number.isFinite gate before .toFixed().
                  The `price > 0` check one level up only gated the price span; the
                  changePct branch dereferenced an unvalidated number and could
                  crash the whole panel with "Cannot read properties of null
                  (reading 'toFixed')" when Yahoo returned a halt quote. */}
              {apiData.quote.changePct != null && Number.isFinite(apiData.quote.changePct) && (
                <span
                  className={
                    apiData.quote.changePct >= 0 ? 'text-green-400' : 'text-red-400'
                  }
                >
                  {apiData.quote.changePct >= 0 ? '+' : ''}
                  {apiData.quote.changePct.toFixed(2)}%
                </span>
              )}
              {apiData.quote.quoteTime && (
                <span className="text-slate-400">
                  {formatFreshness(apiData.quote.quoteTime, { stamp: 'vendor', calendar: 'us-equity' })}
                </span>
              )}
            </div>
          )}

          {/* Data source line.
              UX-6: this said "Source: Yahoo Finance …" and then the illustrative
              flow gauge and the illustrative prints table rendered directly
              beneath it, with nothing marking where the attribution stopped. It
              now names the metrics it actually covers and disclaims the rest. */}
          <div className="text-[10px] text-slate-400 leading-relaxed">
            Source for the figures above: Yahoo Finance (short interest, share counts, 10-day average
            volume).{' '}
            {apiData.fetchedAt && (
              <>Fetched: <LocalTime value={apiData.fetchedAt} withDate />. </>
            )}
            The flow gauge and the block prints below are not from this source.
          </div>
        </>
      )}

      {/* ── Off-exchange flow gauge (ILLUSTRATIVE) ────────────────────
          UX-6: `bullishPct` is derived from `prints`, which are always
          synthetic, so this gauge is synthetic too — it was gated on the
          tautology `(hasRealData || true)` (a flag since removed), i.e. always rendered, immediately
          under the real Yahoo provenance line and with no label of its own. The
          dead conditional is gone and the badge is now part of the header. */}
      <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-800" role="region" aria-label="Off-exchange flow sentiment (illustrative)">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
          <span aria-label="Bearish sentiment">BEARISH</span>
          <span className="text-slate-300 font-medium flex items-center gap-2">
            Off-Exchange Flow
            <span className="px-2 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-500/30 text-[10px]">
              ILLUSTRATIVE
            </span>
          </span>
          <span aria-label="Bullish sentiment">BULLISH</span>
        </div>
        <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(bullishPct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${bullishPct.toFixed(0)}% bullish flow (illustrative)`}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${bullishPct}%`,
              background: `linear-gradient(90deg, #ff6b7a 0%, ${color} 100%)`,
            }}
          />
        </div>
        <div className="flex justify-between text-xs mt-1.5">
          <span className="text-red-400">{(100 - bullishPct).toFixed(0)}%</span>
          <span style={{ color }}>{bullishPct.toFixed(0)}%</span>
        </div>
      </div>

      {/* ── Block prints table (illustrative demo) ───────────────── */}
      <div className="bg-slate-900/60 rounded-xl border border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-semibold text-white">
            Block Prints — {ticker}
          </span>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            {/* UX-6: unconditional. `prints` come from lib/mockData.ts's
                mulberry32 generator on EVERY render path. The badge used to be
                gated on a flag (`hasRealData`, since removed) that described the
                Yahoo figures above, not this table, so it vanished exactly on the
                liquid tickers a professional trades — fabricated prints near $100
                beside a real quote three times higher, with no badge. */}
            <span className="px-2 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-500/30 text-[10px]">
              ILLUSTRATIVE
            </span>
            <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Bullish
            <span className="w-2 h-2 rounded-full bg-purple-400 inline-block ml-1" /> Bearish
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Illustrative dark pool prints — generated examples, not real trades</caption>
            <thead>
              <tr className="text-slate-400 border-b border-slate-800">
                <th scope="col" className="text-left px-4 py-2 font-medium">Time</th>
                <th scope="col" className="text-right px-3 py-2 font-medium">Size</th>
                <th scope="col" className="text-right px-3 py-2 font-medium">Price</th>
                <th scope="col" className="text-right px-3 py-2 font-medium">vs VWAP</th>
                <th scope="col" className="text-center px-3 py-2 font-medium">Type</th>
                <th scope="col" className="text-center px-3 py-2 font-medium">Signal</th>
              </tr>
            </thead>
            <tbody>
              {prints.slice(0, 10).map((print, i) => (
                <tr
                  key={i}
                  className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
                >
                  <td className="px-4 py-2.5 font-mono text-slate-400">{print.time}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-white">
                    {(print.size / 1000).toFixed(0)}K
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-white">
                    ${print.price.toFixed(2)}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono ${
                      print.premium > 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {print.premium > 0 ? '+' : ''}
                    {(print.premium).toFixed(2)}%
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        print.type === 'SWEEP'
                          ? 'bg-yellow-900/40 text-yellow-400'
                          : print.type === 'BLOCK'
                            ? 'bg-blue-900/40 text-blue-400'
                            : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {print.type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={`w-2 h-2 rounded-full inline-block ${
                        print.sentiment === 'BULLISH'
                          ? 'bg-blue-400 shadow-sm shadow-blue-400'
                          : print.sentiment === 'BEARISH'
                            ? 'bg-purple-400 shadow-sm shadow-purple-400'
                            : 'bg-slate-500'
                      }`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* UX-6: same reasoning as the badge — the footnote was suppressed by
            the success of an unrelated call. It describes this table, so it
            renders whenever this table does. */}
        <div className="px-4 py-2.5 text-xs text-slate-400 text-center border-t border-slate-800">
          <span className="text-amber-400/80">
            ⚠ Illustrative block prints — not from a proprietary data feed.
          </span>
          {' '}No data source for individual off-exchange prints is connected.
        </div>
      </div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      <div className="text-[10px] text-slate-400 mb-1 leading-tight">{label}</div>
      <div className="text-lg font-bold font-mono text-white">{value}</div>
      <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">{sub}</div>
    </div>
  )
}

/**
 * Display formatters for backtest result metrics.
 *
 * Extracted so the non-finite handling is unit-testable without a jsdom render
 * (the full component suite is heavy on this workspace's FUSE mount).
 */

/**
 * Format a profit factor for display.
 *
 * Profit factor is gross profit / gross loss. When an instrument (or the
 * portfolio) has winning trades and ZERO losing trades, the backtest engine
 * reports it as `Infinity` (`core.ts` / `engine.ts`). Crucially, `Infinity`
 * does not survive `JSON.stringify` — `NextResponse.json` turns it into `null`
 * — so by the time the value reaches the client it is `null`, not `Infinity`.
 *
 * The previous inline guard tested only `=== Infinity`, which never matched the
 * post-serialization `null`, so `null.toFixed(2)` threw and crashed the table
 * render. Treat any non-finite / nullish value (the "no losses" case) as ∞.
 */
export function formatProfitFactor(pf: number | null | undefined): string {
  if (pf == null || !Number.isFinite(pf)) return '∞'
  return pf.toFixed(2)
}

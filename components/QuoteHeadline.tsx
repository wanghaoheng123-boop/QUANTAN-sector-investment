/**
 * Q-145 — the change line and the missing-quote state under the price on the
 * stock and sector page headers.
 *
 * Both headers carried the same inline JSX, so a test of one proved nothing
 * about the other, and red-team Q145-R1 removed either null branch with the
 * suite green. One component, rendered by both and tested directly.
 */
import { formatSignedNumber } from '@/lib/format'

export function QuoteChangeLine({ change, changePct }: { change: number | null; changePct: number | null }) {
  if (changePct == null || !Number.isFinite(changePct)) {
    return <div className="text-sm font-mono text-slate-400">— (no change data)</div>
  }
  const up = changePct >= 0
  return (
    <div className={`text-sm font-mono ${up ? 'text-green-400' : 'text-red-400'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span> {formatSignedNumber(change)} ({Math.abs(changePct).toFixed(2)}%)
    </div>
  )
}

/**
 * Shown where the price would be when there is none to show: the vendor could
 * not price the ticker, the response left it out, or the request failed. It
 * replaces a pulsing skeleton that, for a quote that is never coming, read as
 * "still loading" forever (red-team Q145-R2).
 */
export function QuoteUnavailable({ reason }: { reason: string }) {
  return (
    <div className="text-right" role="status">
      <div className="text-2xl font-bold text-slate-400 font-mono">—</div>
      <div className="text-xs text-slate-400 mt-1 max-w-[16rem]">{reason}</div>
    </div>
  )
}

/**
 * The stream status beside the price. Red-team Q145-R2-9: the stream's
 * `degraded` event (the vendor fetch failed) was stored and read by nobody, so a
 * failed stream's pill said CLOSED — or LIVE — over a price that had stopped
 * updating. It says DEGRADED, with the reason in its title.
 */
export function StreamStatusPill({ connected, marketOpen, supported, error }: {
  connected: boolean
  marketOpen: boolean
  supported: boolean
  error: string | null
}) {
  const state = error ? 'degraded' : connected ? (marketOpen ? 'live' : 'closed') : 'reconnect'
  const pillClass = {
    live: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    closed: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    degraded: 'bg-amber-500/15 text-amber-300 border border-amber-500/40',
    reconnect: 'bg-slate-700/40 text-slate-400 border border-slate-600/40',
  }[state]
  const dotClass = { live: 'bg-emerald-400 animate-pulse', closed: 'bg-amber-400', degraded: 'bg-amber-400', reconnect: 'bg-slate-500' }[state]
  const title = {
    live: 'Live stream connected — market open',
    closed: 'Live stream connected — market closed (snapshot)',
    degraded: `Stream degraded: ${error ?? ''}`,
    reconnect: supported ? 'Reconnecting…' : 'Polling (SSE unavailable)',
  }[state]
  const label = { live: 'LIVE', closed: 'CLOSED', degraded: 'DEGRADED', reconnect: 'RECONNECT' }[state]
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${pillClass}`} title={title} role="status">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      {label}
    </span>
  )
}

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

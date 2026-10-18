'use client'

import { slopeState, slopeText } from '@/lib/quant/technicals'
import { halfKelly } from '@/lib/quant/kelly'
import { fmtB, fmtPct } from '@/components/stock/quantlab/formatters'
import type { QuantLabAdvMetrics } from '@/components/stock/quantlab/hooks/useQuantLabFundamentals'
import type { QuantLabPayload } from '@/components/stock/quantlab/types'

export function TechnicalsTab({
  data,
  adv,
  advLoading,
  advError,
  kellyP,
  setKellyP,
  kellyWin,
  setKellyWin,
  kellyLoss,
  setKellyLoss,
}: {
  data: QuantLabPayload
  adv: QuantLabAdvMetrics | null
  advLoading: boolean
  /** Q-140: why the extended analytics are missing, when they are. */
  advError?: string | null
  kellyP: number
  setKellyP: (v: number) => void
  kellyWin: number
  setKellyWin: (v: number) => void
  kellyLoss: number
  setKellyLoss: (v: number) => void
}) {
  if (!data.technicals) {
    return <p className="text-sm text-slate-400">Technicals could not be computed for this symbol.</p>
  }

  return (
    <div className="space-y-6">
            <p className="text-xs text-slate-400">
              Indicators use daily closes (~2y+ when available). The ±2×ATR(14) levels are distances from the last close, not stop placement.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {[
                ['SMA20', data.technicals.sma20?.toFixed(2) ?? '—'],
                ['SMA50', data.technicals.sma50?.toFixed(2) ?? '—'],
                ['SMA200', data.technicals.sma200?.toFixed(2) ?? '—'],
                ['RSI(14)', data.technicals.rsi14?.toFixed(1) ?? '—'],
                ['MACD', data.technicals.macd.histogram?.toFixed(3) ?? '—'],
                ['MACD sig', data.technicals.macd.signal?.toFixed(3) ?? '—'],
                ['Boll %B', data.technicals.bollinger.pctB?.toFixed(2) ?? '—'],
                ['ATR(14)', data.technicals.atr14?.toFixed(3) ?? '—'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
                  <div className="text-slate-400 text-[10px]">{k}</div>
                  <div className="font-mono text-white mt-0.5">{v}</div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-slate-800 p-4 space-y-2">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Trend structure</h3>
              <p className="text-sm text-slate-300">{data.technicals.trendLabel}</p>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono text-slate-400">
                <span>Max DD (sample): {data.technicals.maxDrawdownPct != null ? fmtPct(data.technicals.maxDrawdownPct) : '—'}</span>
                <span>Sharpe (ann.): {data.technicals.sharpe?.toFixed(2) ?? '—'}</span>
                <span>Sortino (ann.): {data.technicals.sortino?.toFixed(2) ?? '—'}</span>
                <span>Vol 20d/60d: {data.technicals.volRegime20over60?.toFixed(2) ?? '—'}</span>
              </div>
            </div>

            {/* 200-day MA deviation regime: distance and slope, described (Q-153).
                Q153-C1/C5/C6: no class badge (its labels were not true of the
                classes), no "Risk: low/high" (an unmeasured claim, rendered in
                green), and one neutral colour — red/green is kept only for the
                sign of the measured slope. */}
            {data.ma200Regime && (
              <div className="rounded-xl border border-slate-800 p-4">
                <div className="text-[10px] uppercase tracking-widest mb-1 text-slate-400">200-day average: distance and slope</div>
                <div className="text-xl font-bold text-slate-200">{data.ma200Regime.label}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {data.technicals.sma200 != null
                    ? `200DMA: $${data.technicals.sma200.toFixed(2)}`
                    : ''}
                  {data.ma200Regime.deviationPct != null
                    ? ` · Deviation: ${data.ma200Regime.deviationPct >= 0 ? '+' : ''}${data.ma200Regime.deviationPct.toFixed(1)}%`
                    : ''}
                </div>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  {data.ma200Regime.dipSignalExplained}
                </p>
                <div className="mt-2 text-[10px] text-slate-400">
                  <span className="uppercase tracking-wide mr-1">200MA slope: </span>
                  <span
                    className={
                      slopeState(data.ma200Regime.slopePct) === 'rising'
                        ? 'text-emerald-400'
                        : slopeState(data.ma200Regime.slopePct) === 'falling'
                          ? 'text-red-400'
                          : 'text-slate-300'
                    }
                  >
                    {slopeText(data.ma200Regime.slopePct)}
                  </span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-800 p-4">
                {/* Q-153: levels, not stops — "reference stops" / "long risk" was
                    stop-placement copy of the kind removed from the sector page (S1). */}
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Last close ± 2 × ATR(14)</h3>
                <div className="text-xs space-y-1 font-mono text-slate-300">
                  <div>2 ATR below: {data.technicals.atrStopLong?.toFixed(2) ?? '—'}</div>
                  <div>2 ATR above: {data.technicals.atrStopShort?.toFixed(2) ?? '—'}</div>
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 p-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">52-week range</h3>
                <div className="text-xs space-y-1 font-mono text-slate-300">
                  <div>High: {data.range52w?.high?.toFixed(2) ?? '—'}</div>
                  <div>Low: {data.range52w?.low?.toFixed(2) ?? '—'}</div>
                  <div>Position in range: {data.range52w?.position != null ? fmtPct(data.range52w.position) : '—'}</div>
                </div>
              </div>
            </div>

            {data.fibRetracement && (
              <div className="rounded-xl border border-slate-800 p-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Fib retracement (52w high → low)</h3>
                <div className="flex flex-wrap gap-3 text-xs font-mono text-slate-300">
                  <span>38.2%: {data.fibRetracement.fib382.toFixed(2)}</span>
                  <span>50%: {data.fibRetracement.fib500.toFixed(2)}</span>
                  <span>61.8%: {data.fibRetracement.fib618.toFixed(2)}</span>
                </div>
              </div>
            )}

            {data.pivots && (
              <div className="rounded-xl border border-slate-800 p-4 overflow-x-auto">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Classic pivots (prior session)</h3>
                <table className="w-full text-xs font-mono text-slate-300">
                  <tbody>
                    <tr className="border-b border-slate-800/60">
                      <td className="py-1 text-slate-400">P</td>
                      <td className="text-right">{data.pivots.pivot.toFixed(2)}</td>
                      <td className="pl-4 text-slate-400">R1</td>
                      <td className="text-right">{data.pivots.r1.toFixed(2)}</td>
                      <td className="pl-4 text-slate-400">S1</td>
                      <td className="text-right">{data.pivots.s1.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-slate-400">R2</td>
                      <td className="text-right">{data.pivots.r2.toFixed(2)}</td>
                      <td className="pl-4 text-slate-400">S2</td>
                      <td className="text-right">{data.pivots.s2.toFixed(2)}</td>
                      <td className="pl-4 text-slate-400">R3/S3</td>
                      <td className="text-right">
                        {data.pivots.r3.toFixed(2)} / {data.pivots.s3.toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {data.relative && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4">
                <h3 className="text-xs font-semibold text-emerald-400/90 uppercase tracking-widest mb-2">Relative strength vs SPY</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono text-slate-300">
                  <div>ρ (log ret, ~6m): {data.relative.correlationVsSpy?.toFixed(2) ?? '—'}</div>
                  <div>Excess 20d: {data.relative.excessReturn20dVsSpy != null ? fmtPct(data.relative.excessReturn20dVsSpy) : '—'}</div>
                  <div>Excess 60d: {data.relative.excessReturn60dVsSpy != null ? fmtPct(data.relative.excessReturn60dVsSpy) : '—'}</div>
                  <div>Aligned days: {data.relative.alignedSessions}</div>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-700 p-4 space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Extended analytics (5y history)</h3>
              {advLoading && <p className="text-xs text-slate-400">Loading up-day share & beta proxy…</p>}
              {!advLoading && advError && (
                <p role="status" data-testid="adv-error" className="text-xs text-amber-400">Extended analytics failed to load ({advError}).</p>
              )}
              {adv && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs font-mono text-slate-300">
                  {/* Q153-C16: the share of UP DAYS, not the win rate of any strategy. */}
                  <div>Up days (~252d): {adv.winRate252d != null ? fmtPct(adv.winRate252d) : '—'}</div>
                  <div>Beta* (vs SPY logs): {adv.betaVsSpyLogReturns?.toFixed(2) ?? '—'}</div>
                  <div>ρ 1y: {adv.correlationVsSpy1y?.toFixed(2) ?? '—'}</div>
                  <div>Div. yield: {adv.dividendYield != null ? fmtPct(adv.dividendYield) : '—'}</div>
                  <div className="md:col-span-2">Avg vol 3m: {adv.avgVolume3m != null ? fmtB(adv.avgVolume3m) : '—'}</div>
                </div>
              )}
              {adv?.note && <p className="text-[10px] text-slate-400">{adv.note}</p>}
            </div>

            <div className="rounded-xl border border-blue-500/25 bg-blue-950/10 p-4 space-y-3">
              <h3 className="text-xs font-semibold text-blue-300 uppercase tracking-widest">Kelly calculator (education)</h3>
              <p className="text-[10px] text-slate-400">
                f* = p − (1−p)/b with b = avgWin/avgLoss. Shown: <strong className="text-slate-400">half-Kelly</strong>. Real strategies need transaction costs and correlation across bets.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="text-xs text-slate-400">
                  Win probability
                  <input
                    type="range"
                    min={0.35}
                    max={0.75}
                    step={0.01}
                    value={kellyP}
                    onChange={(e) => setKellyP(parseFloat(e.target.value))}
                    className="w-full mt-1 accent-blue-500"
                  />
                  <span className="font-mono text-white">{(kellyP * 100).toFixed(0)}%</span>
                </label>
                <label className="text-xs text-slate-400">
                  Avg win (R)
                  <input
                    type="range"
                    min={0.5}
                    max={3}
                    step={0.05}
                    value={kellyWin}
                    onChange={(e) => setKellyWin(parseFloat(e.target.value))}
                    className="w-full mt-1 accent-blue-500"
                  />
                  <span className="font-mono text-white">{kellyWin.toFixed(2)}</span>
                </label>
                <label className="text-xs text-slate-400">
                  Avg loss (R)
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.05}
                    value={kellyLoss}
                    onChange={(e) => setKellyLoss(parseFloat(e.target.value))}
                    className="w-full mt-1 accent-blue-500"
                  />
                  <span className="font-mono text-white">{kellyLoss.toFixed(2)}</span>
                </label>
              </div>
              <div className="text-sm font-mono text-blue-200">
                Half-Kelly fraction:{' '}
                {halfKelly(kellyP, kellyWin, kellyLoss) != null
                  ? `${(halfKelly(kellyP, kellyWin, kellyLoss)! * 100).toFixed(2)}% of bankroll`
                  : '—'}
              </div>
            </div>
    </div>
  )
}

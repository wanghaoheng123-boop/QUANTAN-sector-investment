'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
import { fmtB, fmtPct } from '@/components/stock/quantlab/formatters'
import { Metric, PriceRail } from '@/components/stock/quantlab/ui'
import type { QuantLabPayload } from '@/components/stock/quantlab/types'
import { formatCurrency } from '@/lib/format'

export function SummaryTab({ data, summaryOpen, setSummaryOpen }: { data: QuantLabPayload; summaryOpen: boolean; setSummaryOpen: (v: boolean | ((p: boolean) => boolean)) => void }) {
  return (
    <div className="space-y-6">
            <p className="text-[11px] text-slate-500 leading-relaxed border border-slate-800/80 rounded-lg p-3 bg-slate-950/50">
              Fundamentals and history from Yahoo Finance unless you configure a{' '}
              <strong className="text-slate-400">Bloomberg bridge</strong> for spot prices (see README). Models are transparent heuristics, not an unbiased oracle.
              Combine with primary filings (10-K/20-F), your data vendor, and compliance review before acting.
            </p>

            {data.dataLineage && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2 text-[10px] text-slate-500 leading-relaxed">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Data lineage</div>
                <p className="font-mono text-slate-400">Fetched (this payload): {data.fetchedAt}</p>
                <ul className="list-disc pl-4 space-y-1">
                  {data.dataLineage.sources.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <p>{data.dataLineage.refresh}</p>
                <p className="text-slate-400">{data.dataLineage.statementNote}</p>
              </div>
            )}

            {data.priceSources?.bloomberg != null && data.priceSources.bloomberg > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-amber-200/90 bg-amber-950/20 border border-amber-500/25 rounded-lg px-3 py-2">
                <span className="font-semibold uppercase tracking-wider text-amber-400/90">Bloomberg spot</span>
                <span className="font-mono">${data.priceSources.bloomberg.toFixed(2)}</span>
                <span className="text-slate-500">
                  (Yahoo ref: {data.priceSources.yahoo != null ? `$${data.priceSources.yahoo.toFixed(2)}` : '—'})
                </span>
              </div>
            )}

            {data.narrative.summary ? (
              <div>
                <button
                  type="button"
                  onClick={() => setSummaryOpen(!summaryOpen)}
                  className="flex items-center gap-2 text-sm font-semibold text-white mb-2"
                >
                  {summaryOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  Business overview
                </button>
                <p className={`text-sm text-slate-400 leading-relaxed ${summaryOpen ? '' : 'line-clamp-4'}`}>
                  {data.narrative.summary}
                </p>
              </div>
            ) : null}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                ['Price', formatCurrency(data.price)],
                ['Trailing P/E', data.market.trailingPE != null ? data.market.trailingPE.toFixed(1) : '—'],
                ['Forward P/E', data.market.forwardPE != null ? data.market.forwardPE.toFixed(1) : '—'],
                ['P/B', data.market.priceToBook != null ? data.market.priceToBook.toFixed(2) : '—'],
                ['EV (raw)', fmtB(data.market.enterpriseValue as number | null)],
                ['Analyst target', data.market.targetMeanPrice != null ? `$${data.market.targetMeanPrice.toFixed(2)}` : '—'],
                ['Vol (ann.)', fmtPct(data.volatility.annualized)],
                ['Beta', data.market.beta != null ? data.market.beta.toFixed(2) : '—'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
                  <div className="text-sm font-mono text-white mt-1">{v}</div>
                </div>
              ))}
            </div>

            {data.earnings && (data.earnings.nextEarningsDate || data.earnings.lastEPSActual != null) && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-slate-500 uppercase tracking-wider text-[10px]">Next earnings</div>
                  <div className="font-mono text-amber-100 mt-1">{data.earnings.nextEarningsDate ?? '—'}</div>
                </div>
                <div>
                  <div className="text-slate-500 uppercase tracking-wider text-[10px]">Last quarter</div>
                  <div className="font-mono text-slate-200 mt-1">{data.earnings.lastQuarterEnd ?? '—'}</div>
                </div>
                <div>
                  <div className="text-slate-500 uppercase tracking-wider text-[10px]">EPS act / est</div>
                  <div className="font-mono text-slate-200 mt-1">
                    {data.earnings.lastEPSActual != null ? data.earnings.lastEPSActual.toFixed(2) : '—'} /{' '}
                    {data.earnings.lastEPSEstimate != null ? data.earnings.lastEPSEstimate.toFixed(2) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 uppercase tracking-wider text-[10px]">Surprise %</div>
                  <div className="font-mono text-slate-200 mt-1">
                    {data.earnings.lastSurprisePct != null ? `${data.earnings.lastSurprisePct.toFixed(1)}%` : '—'}
                  </div>
                </div>
              </div>
            )}

            {data.researchScore && (
              <div className="rounded-xl border border-violet-500/25 bg-violet-950/10 p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-violet-300 uppercase tracking-widest">Research dashboard score</h3>
                    <p className="text-[10px] text-slate-500 mt-1 max-w-xl">{data.researchScore.weights}</p>
                  </div>
                  <div className="text-4xl font-bold font-mono text-white">{Math.round(data.researchScore.total)}</div>
                </div>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {data.researchScore.pillars.map((p) => (
                    <div key={p.name} className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
                      <div className="text-[10px] text-slate-500">{p.name}</div>
                      <div className="text-sm font-mono text-violet-200">{Math.round(p.score)}</div>
                      <p className="text-[10px] text-slate-400 mt-1 leading-snug">{p.detail}</p>
                    </div>
                  ))}
                </div>
                {data.researchScore.rubricLines && data.researchScore.rubricLines.length > 0 && (
                  <div className="mt-4 rounded-lg border border-slate-800/80 bg-slate-950/50 p-3 space-y-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">How to read the score</div>
                    <ul className="text-[10px] text-slate-500 space-y-1.5 list-disc pl-4 leading-relaxed">
                      {data.researchScore.rubricLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    {data.researchScore.benchmarkNote && (
                      <p className="text-[10px] text-slate-400 leading-relaxed pt-1 border-t border-slate-800/60">
                        {data.researchScore.benchmarkNote}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-800 p-4 space-y-2">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Quality & leverage</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Metric label="ROE" value={fmtPct(data.health.returnOnEquity)} />
                  <Metric label="Net margin" value={fmtPct(data.health.profitMargin)} />
                  <Metric label="Op. margin" value={fmtPct(data.health.operatingMargin)} />
                  <Metric label="Debt/Eq" value={data.health.debtToEquity != null ? data.health.debtToEquity.toFixed(2) : '—'} />
                  <Metric label="Current ratio" value={data.health.currentRatio != null ? data.health.currentRatio.toFixed(2) : '—'} />
                  <Metric label="Quick ratio" value={data.health.quickRatio != null ? data.health.quickRatio.toFixed(2) : '—'} />
                  <Metric label="EBITDA margin" value={fmtPct(data.health.ebitdaMargin)} />
                  <Metric label="Rev. growth" value={fmtPct(data.health.revenueGrowth)} />
                  <Metric label="EPS growth" value={fmtPct(data.health.earningsGrowth)} />
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 p-4 space-y-3">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Mechanical band vs price</h3>
                {data.bands?.fairValueMid != null && data.price != null ? (
                  <>
                    <PriceRail
                      price={data.price}
                      fair={data.bands.fairValueMid}
                      buy={data.bands.buyZoneHigh}
                      sell={data.bands.sellZoneLow}
                    />
                    {data.bands.buyZoneHigh != null && (
                      <p className="text-[10px] text-emerald-200/80 font-mono">
                        Mechanical buy-zone ceiling (margin-of-safety line for this model): ≤ ${data.bands.buyZoneHigh.toFixed(2)}
                      </p>
                    )}
                    {data.signal && (
                      <div className="rounded-lg bg-slate-900/60 border border-slate-800 p-3">
                        <div className="text-xs font-semibold text-blue-300">{data.signal.label}</div>
                        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{data.signal.detail}</p>
                      </div>
                    )}
                    <p className="text-[10px] text-slate-400 leading-relaxed">{data.bands.methodology}</p>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Not enough anchors (DCF / analyst / forward heuristic) to draw bands.</p>
                )}
              </div>
            </div>
    </div>
  )
}

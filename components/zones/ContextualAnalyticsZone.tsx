'use client'

type Tier = 'conservative' | 'balanced' | 'aggressive'

interface Candidate {
  tier: Tier
  strike: number
  daysToExpiry: number
  premiumYieldPct: number
  distanceFromSpotPct: number
  rationale: string
}

interface EntryBand {
  tier: Tier
  low: number
  high: number
  note: string
}

interface OptionsIntelligencePayload {
  ticker: string
  spotPrice: number
  maxPainStrike: number
  callWallStrike: number
  putWallStrike: number
  callWallStrength: number
  putWallStrength: number
  confidence: 'high' | 'medium' | 'low'
  confidenceReason: string
  entryBands: EntryBand[]
  sellPutCandidates: Candidate[]
  sellCallCandidates: Candidate[]
  error?: string
}

interface ContextualAnalyticsZoneProps {
  title?: string
  ticker: string
  data: OptionsIntelligencePayload | null
  loading?: boolean
}

function tierColor(tier: Tier): string {
  if (tier === 'conservative') return 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
  if (tier === 'balanced') return 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10'
  return 'text-amber-300 border-amber-500/30 bg-amber-500/10'
}

function confidenceColor(conf: 'high' | 'medium' | 'low'): string {
  if (conf === 'high') return 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
  if (conf === 'medium') return 'text-amber-300 border-amber-500/30 bg-amber-500/10'
  return 'text-red-300 border-red-500/30 bg-red-500/10'
}

function CandidateCard({ side, c }: { side: 'put' | 'call'; c: Candidate }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className={`text-[10px] px-2 py-0.5 rounded border uppercase tracking-wider ${tierColor(c.tier)}`}>{c.tier}</span>
        <span className="text-xs text-slate-400">{c.daysToExpiry}D</span>
      </div>
      <div className="text-sm font-mono text-white">
        Sell {side.toUpperCase()} @ {c.strike.toFixed(2)}
      </div>
      <div className="text-[11px] text-slate-400">
        Distance {c.distanceFromSpotPct >= 0 ? '+' : ''}{c.distanceFromSpotPct.toFixed(2)}% · Yield {c.premiumYieldPct.toFixed(2)}%
      </div>
      <div className="text-[10px] text-slate-500">{c.rationale}</div>
    </div>
  )
}

export default function ContextualAnalyticsZone({ title = 'Contextual Analytics', ticker, data, loading }: ContextualAnalyticsZoneProps) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white uppercase tracking-wider">{title}</h3>
          <p className="text-[11px] text-slate-500 mt-1">Options wall + max pain + safety-tier guidance for {ticker}.</p>
        </div>
        {data && !data.error && (
          <span className={`text-[10px] px-2 py-0.5 rounded border uppercase ${confidenceColor(data.confidence)}`}>
            {data.confidence} confidence
          </span>
        )}
      </div>

      {loading && (
        <div className="text-xs text-slate-500">Loading options intelligence...</div>
      )}

      {!loading && data?.error && (
        <div className="text-xs text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-lg p-3">
          {data.error}
        </div>
      )}

      {!loading && data && !data.error && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2 text-center">
              <div className="text-[10px] text-slate-500">Spot</div>
              <div className="text-sm font-mono text-white">{data.spotPrice.toFixed(2)}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2 text-center">
              <div className="text-[10px] text-slate-500">Max Pain</div>
              <div className="text-sm font-mono text-amber-300">{data.maxPainStrike.toFixed(2)}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2 text-center">
              <div className="text-[10px] text-slate-500">Put Wall</div>
              <div className="text-sm font-mono text-emerald-300">{data.putWallStrike.toFixed(2)}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2 text-center">
              <div className="text-[10px] text-slate-500">Call Wall</div>
              <div className="text-sm font-mono text-red-300">{data.callWallStrike.toFixed(2)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {data.entryBands.map((b) => (
              <div key={b.tier} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <div className={`inline-block text-[10px] px-2 py-0.5 rounded border uppercase ${tierColor(b.tier)}`}>{b.tier} entry band</div>
                <div className="text-xs text-white font-mono mt-2">{b.low.toFixed(2)} - {b.high.toFixed(2)}</div>
                <div className="text-[10px] text-slate-500 mt-1">{b.note}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Sell Put Tiers</div>
              {data.sellPutCandidates.length === 0 ? (
                <div className="text-xs text-slate-500">No liquid put candidates found.</div>
              ) : data.sellPutCandidates.map((c) => <CandidateCard key={`put-${c.tier}`} side="put" c={c} />)}
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Sell Call Tiers</div>
              {data.sellCallCandidates.length === 0 ? (
                <div className="text-xs text-slate-500">No liquid call candidates found.</div>
              ) : data.sellCallCandidates.map((c) => <CandidateCard key={`call-${c.tier}`} side="call" c={c} />)}
            </div>
          </div>

          <div className="text-[10px] text-slate-500 border-t border-slate-800 pt-2">
            Decision support only, not guaranteed outcomes. {data.confidenceReason}
          </div>
        </>
      )}
    </section>
  )
}

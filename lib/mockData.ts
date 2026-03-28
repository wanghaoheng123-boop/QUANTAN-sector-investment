// Mock data generators for prices, dark pool, signals, and news
// Deterministic seeds: same inputs → same outputs for SSR/hydration.
// Demo signals/sparklines use a **calendar-day** seed so they do not “jump” every 15s
// (live ETF prices on the home page still refresh from /api/prices on an interval).

import { Brief, DarkPoolPrint, PriceSignal, SECTORS } from './sectors'

// ─── Seeded PRNG (Mulberry32) — deterministic, no hydration mismatch ─────────
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

// ─── OHLCV Candle Generator ───────────────────────────────────────────────────
export function generateCandles(
  basePrice: number,
  days: number = 252,
  volatility: number = 0.015,
  trend: number = 0.0005,
  seed: number = 42
) {
  const rng = mulberry32(seed)
  const candles = []
  let price = basePrice * 0.72
  const now = new Date('2026-03-23')

  for (let i = days; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(now.getDate() - i)
    if (date.getDay() === 0 || date.getDay() === 6) continue

    const open = price
    const change = (rng() - 0.48) * volatility + trend
    price = price * (1 + change)
    const high = Math.max(open, price) * (1 + rng() * 0.01)
    const low = Math.min(open, price) * (1 - rng() * 0.01)
    const volume = Math.round((800000 + rng() * 1200000) * (1 + Math.abs(change) * 20))

    candles.push({
      time: date.toISOString().split('T')[0],
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(price.toFixed(2)),
      volume
    })
  }
  return candles
}

// ─── Current Quote Generator ────────────────────────────────────────────────
const SEED_PRICES: Record<string, number> = {
  XLK: 218.40,
  XLE: 84.20,
  XLF: 41.80,
  XLV: 138.90,
  XLY: 196.50,
  XLI: 132.40,
  XLC: 83.70,
  XLB: 89.10,
  XLU: 72.30,
  XLRE: 38.50,
  XLP: 79.20,
  SPY: 548.30,
  QQQ: 461.70,
}

/** UTC calendar day as a stable integer (changes at midnight UTC). */
function dailySeed(salt = 0): number {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  return y * 10000 + m * 100 + day + salt
}

export function generateQuote(ticker: string, seedOffset: number = 0) {
  const rng = mulberry32(dailySeed(9) + seedOffset + ticker.charCodeAt(0) * 31)
  const base = SEED_PRICES[ticker] || 100
  const change = (rng() - 0.5) * 4
  const pct = (change / base) * 100
  return {
    ticker,
    price: parseFloat((base + change).toFixed(2)),
    change: parseFloat(change.toFixed(2)),
    changePct: parseFloat(pct.toFixed(2)),
    volume: Math.round(5000000 + rng() * 15000000),
    high52w: parseFloat((base * 1.28).toFixed(2)),
    low52w: parseFloat((base * 0.72).toFixed(2)),
    marketCap: `$${(base * 5e8 / 1e9).toFixed(1)}B`,
    pe: parseFloat((18 + rng() * 15).toFixed(1)),
    timestamp: new Date().toISOString()
  }
}

// ─── Dark Pool Print Generator ──────────────────────────────────────────────
export function generateDarkPoolPrints(ticker: string, count: number = 12): DarkPoolPrint[] {
  const rng = mulberry32(ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0) + 777)
  const base = SEED_PRICES[ticker] || 100
  const types: DarkPoolPrint['type'][] = ['BLOCK', 'SWEEP', 'CROSS']
  const now = new Date('2026-03-23T15:00:00')

  return Array.from({ length: count }, (_, i) => {
    const minutesAgo = i * 18 + Math.round(rng() * 15)
    const time = new Date(now.getTime() - minutesAgo * 60000)
    const size = Math.round((50000 + rng() * 500000) / 100) * 100
    const price = parseFloat((base + (rng() - 0.5) * 2).toFixed(2))
    const premium = parseFloat(((rng() - 0.45) * 1.2).toFixed(3))
    const type = types[Math.floor(rng() * types.length)]
    const bullishBias = type === 'SWEEP' ? 0.6 : 0.45
    const r2 = rng()
    const sentiment: DarkPoolPrint['sentiment'] = r2 < bullishBias ? 'BULLISH' : r2 < 0.75 ? 'BEARISH' : 'NEUTRAL'

    return {
      time: time.toTimeString().slice(0, 8),
      ticker,
      size,
      price,
      premium,
      type,
      sentiment
    }
  }).sort((a, b) => b.time.localeCompare(a.time))
}

// ─── Dark Pool Chart Markers ────────────────────────────────────────────────
export function generateDarkPoolMarkers(candles: { time: string; close: number }[], ticker: string = 'X') {
  const rng = mulberry32(ticker.charCodeAt(0) * 13 + 99)
  return candles
    .filter(() => rng() < 0.10)
    .map(c => ({
      time: c.time,
      price: c.close,
      size: Math.round((100000 + rng() * 800000) / 1000) * 1000,
      sentiment: (rng() > 0.45 ? 'BULLISH' : 'BEARISH') as 'BULLISH' | 'BEARISH'
    }))
}

// ─── Price Signal Generator ─────────────────────────────────────────────────
const SIGNAL_RATIONALES = [
  'RSI divergence at key support zone with institutional accumulation confirmed via dark pool sweep',
  'Breaking above 200-day EMA on high volume; options flow shows heavy call buying',
  'MACD golden cross forming with dark pool prints 2.1% above VWAP — smart money positioning',
  'Sector rotation flow confirmed by ETF inflows; short interest declining rapidly',
  'Earnings catalyst approaching with implied volatility below 30-day realized — premium selling',
  'Geopolitical tailwind driving demand; supply disruption risk premium under-priced',
  'Balance sheet strength + buyback program offering floor; insider buying detected',
  'Technical consolidation near all-time highs with cup-and-handle formation completing',
]

export function generateSignals(seedOffset: number = 0): PriceSignal[] {
  return SECTORS.map((sector, idx) => {
    const rng = mulberry32(dailySeed(3) + idx * 17 + seedOffset + 1234)
    const base = SEED_PRICES[sector.etf] || 100
    const rand = rng()
    const direction: PriceSignal['direction'] =
      rand > 0.6 ? 'BUY' : rand > 0.35 ? 'HOLD' : rand > 0.15 ? 'SELL' : 'WATCH'
    const confidence = Math.round(55 + rng() * 40)
    const entry = base + (rng() - 0.5) * 2
    const stopLoss = direction === 'BUY'
      ? entry * (1 - 0.03 - rng() * 0.03)
      : entry * (1 + 0.03 + rng() * 0.03)
    const target = direction === 'BUY'
      ? entry * (1 + 0.07 + rng() * 0.08)
      : entry * (1 - 0.07 - rng() * 0.08)
    const timeframes: PriceSignal['timeframe'][] = ['1D', '1W', '1M', '3M']

    return {
      sector: sector.name,
      etf: sector.etf,
      direction,
      confidence,
      entry: parseFloat(entry.toFixed(2)),
      stopLoss: parseFloat(stopLoss.toFixed(2)),
      target: parseFloat(target.toFixed(2)),
      timeframe: timeframes[Math.floor(rng() * timeframes.length)],
      rationale: SIGNAL_RATIONALES[Math.floor(rng() * SIGNAL_RATIONALES.length)],
      timestamp: new Date().toISOString()
    }
  })
}

// ─── Sparkline generator (7-day mini price history) ────────────────────────
export function generateSparkline(ticker: string): number[] {
  const rng = mulberry32(ticker.charCodeAt(0) * 7 + dailySeed(7) + 555)
  const base = SEED_PRICES[ticker] || 100
  let price = base * 0.97
  return Array.from({ length: 14 }, () => {
    price = price * (1 + (rng() - 0.48) * 0.012)
    return parseFloat(price.toFixed(2))
  })
}

// ─── News Articles Generator ────────────────────────────────────────────────
const SECTOR_NEWS: Record<string, { title: string; source: string; url: string; summary: string; impact: 'positive' | 'negative' | 'neutral' }[]> = {
  technology: [
    { title: 'NVIDIA Sets New AI Compute Record as H200 Demand Surges', source: 'Bloomberg', url: 'https://bloomberg.com', summary: 'Data center revenue hits $22.6B quarterly run-rate amid enterprise AI buildout acceleration.', impact: 'positive' },
    { title: 'Microsoft Copilot Drives Enterprise Adoption to 1.3M Seats', source: 'WSJ', url: 'https://wsj.com', summary: 'Azure AI revenue growing 38% YoY, raising FY27 guidance above consensus.', impact: 'positive' },
    { title: 'Apple Intelligence Delayed in EU Amid Regulatory Standoff', source: 'FT', url: 'https://ft.com', summary: 'DMA compliance requirements pushing back European AI feature rollout to Q3 2026.', impact: 'negative' },
    { title: 'AMD Captures 23% of Data Center GPU Market Share — Analyst Note', source: 'Barclays', url: 'https://barclays.com', summary: 'MI300X adoption accelerating across hyperscalers; price premium to NVIDIA narrowing.', impact: 'neutral' },
  ],
  energy: [
    { title: 'Brent Crude Holds $88 as IEA Reserve Release Offsets Hormuz Risk', source: 'Reuters', url: 'https://reuters.com', summary: 'IEA proposes 182M barrel coordinated release; Strait of Hormuz at 3% normal transit capacity.', impact: 'neutral' },
    { title: 'ExxonMobil Raises Guyana Output Target by 15% on New Discovery', source: 'FT', url: 'https://ft.com', summary: 'Stabroek Block adds 1.2B proven barrels; offshore production now 660,000 bpd.', impact: 'positive' },
    { title: 'Natural Gas Storage Deficit Widest in 3 Years as Power Demand Surges', source: 'EIA', url: 'https://eia.gov', summary: 'AI data center power demand pushing electricity prices and gas consumption to records.', impact: 'positive' },
    { title: 'Saudi Aramco Cuts OSP for Asian Buyers — Second Month Running', source: 'Argus', url: 'https://argusmedia.com', summary: 'Asian demand softness forces price cuts; OPEC+ compliance under scrutiny.', impact: 'negative' },
  ],
  financials: [
    { title: 'JPMorgan Net Interest Income Guidance Raised on Steeper Yield Curve', source: 'Bloomberg', url: 'https://bloomberg.com', summary: 'NII guidance rises $2.5B as 10Y-2Y spread widens to 85bps, widest since 2022.', impact: 'positive' },
    { title: 'Visa Cross-Border Volume Hits Record as Travel Demand Accelerates', source: 'CNBC', url: 'https://cnbc.com', summary: 'International card spend +19% YoY; CEO flags Asia-Pacific as key growth engine.', impact: 'positive' },
    { title: 'Fed Signals Pause Durability as Labor Market Remains Firm', source: 'FT', url: 'https://ft.com', summary: 'FOMC minutes show broad consensus for holding rates; first cut not expected before Q4 2026.', impact: 'neutral' },
    { title: 'Private Credit Deployed $400B in Q1 — Crowding Out Public Market', source: 'WSJ', url: 'https://wsj.com', summary: 'Direct lending spreads compressing as capital deployment accelerates.', impact: 'negative' },
  ],
  healthcare: [
    { title: 'Eli Lilly Phase 3 Alzheimer Data Shows 60% Plaque Clearance', source: 'NEJM', url: 'https://nejm.org', summary: 'Donanemab trial confirms cognitive decline delay; FDA Priority Review expected Q2 2026.', impact: 'positive' },
    { title: 'UNH Drops 13% on DOJ Antitrust Investigation of Optum', source: 'Bloomberg', url: 'https://bloomberg.com', summary: 'Vertical integration practices at Optum Health under scrutiny; CEO calls probe unfounded.', impact: 'negative' },
    { title: 'GLP-1 Market to Hit $130B by 2030 — Goldman Sachs Research', source: 'GS Research', url: 'https://goldmansachs.com', summary: 'Novo Nordisk and Eli Lilly maintain duopoly; oral formulations entering Phase 3.', impact: 'positive' },
    { title: 'CRISPR Cure for Sickle Cell Disease Receives Expanded Medicare Coverage', source: 'CMS', url: 'https://cms.gov', summary: 'Casgevy coverage decision opens $2.2B US market; CRSP shares +8% on announcement.', impact: 'positive' },
  ],
  'consumer-discretionary': [
    { title: 'Amazon Prime Subscribers Hit 260M Globally — Advertising Revenue Surges', source: 'CNBC', url: 'https://cnbc.com', summary: 'Ad-supported Prime Video reaches 100M MAUs; AWS operating income +47% YoY.', impact: 'positive' },
    { title: 'Tesla Model 2 Pre-Orders Exceed 450,000 in First 72 Hours', source: 'Reuters', url: 'https://reuters.com', summary: '$25,000 price point drives mass-market demand; production slated for Austin, TX.', impact: 'positive' },
    { title: 'Nike Margin Improvement Signals Turnaround — Direct-to-Consumer +26%', source: 'FT', url: 'https://ft.com', summary: 'EBIT margin recovers to 13.2%; wholesale channel stabilizing after 4 quarters of decline.', impact: 'positive' },
    { title: 'Home Depot Sees Spring Selling Season Headwinds from Tariff-Driven Lumber Costs', source: 'Bloomberg', url: 'https://bloomberg.com', summary: 'Tariff exposure creates margin risk; Canada lumber tariffs now at 34.5%.', impact: 'negative' },
  ],
  industrials: [
    { title: 'GE Aerospace Backlog Hits $220B — Largest in Company History', source: 'WSJ', url: 'https://wsj.com', summary: 'LEAP engine demand from narrow-body aircraft drives multi-year visibility; margins expanding.', impact: 'positive' },
    { title: 'Defense Spending Bill Passes at $985B — RTX, LMT Upgrade to Outperform', source: 'Goldman Sachs', url: 'https://goldmansachs.com', summary: 'NATO allies committing additional $150B in US defense procurement.', impact: 'positive' },
    { title: 'Union Pacific Volumes +7% on Near-Shoring Driven Intermodal Demand', source: 'CNBC', url: 'https://cnbc.com', summary: 'Mexico trade corridor at record utilization; pricing power strongest in a decade.', impact: 'positive' },
    { title: 'Tariff Uncertainty Weighs on Industrial Supply Chain Order Visibility', source: 'Bloomberg', url: 'https://bloomberg.com', summary: 'Complex global supply chain exposure makes tariff impact assessment difficult.', impact: 'negative' },
  ],
  communication: [
    { title: 'Meta AI Assistant Has 1B MAUs — Advertising Monetization Begins', source: 'FT', url: 'https://ft.com', summary: 'Meta AI integrated across WhatsApp, Instagram, Messenger driving engagement uplift.', impact: 'positive' },
    { title: 'Netflix Password Sharing Revenue Now $4.2B Annualized Run Rate', source: 'Bloomberg', url: 'https://bloomberg.com', summary: 'Paid sharing launch drives net adds above 22M for second consecutive quarter.', impact: 'positive' },
    { title: 'Google Gemini Ultra Wins Enterprise AI Procurement vs. GPT-4o', source: 'Wired', url: 'https://wired.com', summary: 'Fortune 500 deployments favor Google Workspace integration; Vertex AI bookings tripling.', impact: 'positive' },
    { title: 'AT&T Faces $2.3B Pension Liability Shortfall as Rates Hold Longer', source: 'WSJ', url: 'https://wsj.com', summary: 'Duration mismatch in pension portfolio creates headwind if long rates remain elevated.', impact: 'negative' },
  ],
  materials: [
    { title: 'Copper Hits $5.20/lb on EV Battery and Grid Infrastructure Demand', source: 'Bloomberg', url: 'https://bloomberg.com', summary: 'Freeport-McMoRan guidance raised; Chile supply disruptions limiting inventory builds.', impact: 'positive' },
    { title: 'Linde Hydrogen Infrastructure Wins $8B DOE Grant for US Network', source: 'FT', url: 'https://ft.com', summary: 'Clean hydrogen hubs becoming backbone of industrial decarbonization strategy.', impact: 'positive' },
    { title: 'Gold Breaks $3,200 as Dollar Weakness and Safe-Haven Demand Converge', source: 'Reuters', url: 'https://reuters.com', summary: 'Central bank buying at 55-year high; Newmont production costs declining on energy.', impact: 'positive' },
    { title: 'Lithium Carbonate Prices Recover 40% from Lows — Supply Cuts Bite', source: 'Argus', url: 'https://argusmedia.com', summary: 'Chilean and Australian producers curtailing output; battery demand approaching supply floor.', impact: 'positive' },
  ],
  utilities: [
    { title: 'NextEra Secures 15GW of AI Data Center Power Purchase Agreements', source: 'Bloomberg', url: 'https://bloomberg.com', summary: 'Hyperscaler demand drives NEE into longest backlog in company history; 30-year PPAs.', impact: 'positive' },
    { title: 'Grid Modernization Bill Allocates $78B for AI Power Infrastructure', source: 'DOE', url: 'https://energy.gov', summary: 'Transmission buildout critical as AI capacity doubles US power demand projections.', impact: 'positive' },
    { title: 'PG&E Wildfire Liability Cap Enacted — Stock Surges 18%', source: 'WSJ', url: 'https://wsj.com', summary: 'California SB-1077 provides regulatory certainty; credit rating agencies signal upgrade.', impact: 'positive' },
    { title: 'Rate Sensitivity Risk: Utility P/Es Compress If 10Y Breaks 4.8%', source: 'Barclays', url: 'https://barclays.com', summary: 'Utilities trading at 20× forward earnings; elevated duration risk vs historical norms.', impact: 'negative' },
  ],
  'real-estate': [
    { title: 'Prologis Industrial REIT Revenue +22% on E-Commerce Logistics Demand', source: 'Bloomberg', url: 'https://bloomberg.com', summary: 'Rent spreads at 60%+; portfolio occupancy 97.8%; expanding into Southeast Asia.', impact: 'positive' },
    { title: 'Equinix Data Center REIT Raises $5B for AI Hyperscale Expansion', source: 'FT', url: 'https://ft.com', summary: 'New builds in Dallas, Phoenix, Singapore driven by NVIDIA cluster deployments.', impact: 'positive' },
    { title: 'CRE Office Vacancy Rate Hits Record 19.4% in Major US Markets', source: 'WSJ', url: 'https://wsj.com', summary: 'Remote work entrenchment continues to pressure CBD office values.', impact: 'negative' },
    { title: 'Welltower Senior Housing Portfolio Occupancy Hits Highest Since 2019', source: 'CNBC', url: 'https://cnbc.com', summary: 'Baby boomer demographic accelerating senior housing demand; NOI margins expanding.', impact: 'positive' },
  ],
  'consumer-staples': [
    { title: 'Costco Membership Fee Hike: 1.1% Cancellation Rate Suggests Pricing Power Intact', source: 'Bloomberg', url: 'https://bloomberg.com', summary: 'First fee increase in 7 years absorbed with minimal churn; renewals at 93% globally.', impact: 'positive' },
    { title: 'Walmart Grocery Market Share Hits 26% — Up From 22% During Inflation Peak', source: 'WSJ', url: 'https://wsj.com', summary: 'Walmart+ membership driving basket size and frequency; private label penetration expanding.', impact: 'positive' },
    { title: 'Food Inflation Re-Acceleration Risk as Agricultural Commodity Prices Rise', source: 'FT', url: 'https://ft.com', summary: 'CBOT corn futures up 18% YTD; tariff effects on imported food categories adding to pressure.', impact: 'negative' },
    { title: 'Coca-Cola Revamps Portfolio With $5B Functional Beverage Acquisitions', source: 'Reuters', url: 'https://reuters.com', summary: 'Energy, sports nutrition, and wellness categories growing at 3× the rate of CSD.', impact: 'positive' },
  ],
}

export function getNewsForSector(sector: string) {
  return SECTOR_NEWS[sector] || SECTOR_NEWS.technology
}

// ─── Brief Articles ─────────────────────────────────────────────────────────
export const BRIEFS: Brief[] = [
  {
    id: 1,
    title: 'AI Power Demand Creates Once-in-a-Decade Utilities Opportunity',
    summary: 'Data center electricity demand is accelerating beyond grid capacity projections, placing regulated utilities in an unexpected growth position.',
    sector: 'utilities',
    timestamp: '2026-03-23T06:30:00Z',
    readTime: 5,
    tags: ['AI', 'Power Grid', 'Data Centers', 'NextEra', 'REITs'],
    content: `The electricity demand surge from AI training infrastructure is reshaping the fundamental investment thesis for regulated utilities — a sector historically rewarded for predictability, not growth.

Hyperscaler demand for reliable, 24/7 carbon-free power is now driving a structural recalibration. NextEra Energy has signed power purchase agreements for **15GW of new generation capacity** — nearly double what analysts projected 18 months ago. The contracts average 30-year terms at prices 40% above traditional utility off-take agreements, providing visibility that exceeds most infrastructure assets.

The signal most investors are missing: the bottleneck is not generation — it's **transmission**. Grid interconnection queues now exceed 2,400GW nationally, with average wait times stretching to 5+ years. Companies with existing transmission rights and substation infrastructure (AEP, Eversource, Entergy) are quietly becoming strategic assets.

Nuclear holds a disproportionate advantage. NuScale's completed small modular reactor delivers 24/7 carbon-free baseload at costs now tracking below new gas peakers in deregulated markets. The DOE's $78B grid modernization allocation heavily favors nuclear, with 47 utility procurement agreements already signed — suggesting a structural inflection that rate-sensitive utility bulls may underappreciate.

**The risk matrix:** California wildfire liability reform has substantially reduced regulatory uncertainty for PG&E and Edison International. The primary remaining risk is interest rate duration sensitivity — utilities trade at approximately 20× forward earnings, giving them elevated P/E compression exposure if the 10Y breaks above 4.8%.

**Investment signal:** **Sector Overweight**. The risk-reward is most attractive in diversified regulated utilities with nuclear exposure (SO, AEP) and data center-focused infrastructure REITs (EQIX, DLR). Position sizing: 8–12% sector allocation with stop at 3.8% 10Y yield.`,
    signals: [
      { key: 'Grid Interconnection Queue', value: '2,400+ GW backlogged', impact: 'positive' },
      { key: 'NextEra PPA Backlog', value: '$80B+ contracted', impact: 'positive' },
      { key: '10Y Rate Risk', value: 'Break >4.8% = P/E compression', impact: 'negative' },
      { key: 'Nuclear SMR', value: '47 utility agreements signed', impact: 'positive' },
    ]
  },
  {
    id: 2,
    title: 'NVIDIA\'s Monopoly Is Real — But the Trade Has Changed',
    summary: 'Blackwell GPU demand remains near-insatiable, yet the risk-reward for NVDA momentum trades has structurally shifted from expansion to execution.',
    sector: 'technology',
    timestamp: '2026-03-23T04:15:00Z',
    readTime: 6,
    tags: ['NVIDIA', 'AI', 'Semiconductors', 'Data Center', 'Supply Chain'],
    content: `NVIDIA's current pricing power is historically exceptional. H200/B200 clusters are sold out through late 2027, spot market premia exceed 40% over list price, and gross margins have stabilized above 73% — a level no hardware company has sustained at this scale.

The strategic question for sophisticated investors is not whether NVIDIA's moat is real. It is: **has the easy trade concluded?**

Three signals suggest a regime transition from "monopoly discovery" to "monopoly management":

**1. AMD's market share is now measurable.** MI300X captured 23% of new enterprise data center GPU deployments in Q1 2026 according to Barclays research. This is not existential for NVIDIA — CUDA's software moat is substantial — but it eliminates the "winner takes all everything forever" narrative that justified 35× revenue multiples.

**2. Chinese restrictions are creating permanent revenue ceilings.** Export controls on A100/H100-class chips to China cost NVIDIA an estimated $15–18B in annual revenue. Domestic Chinese alternatives (Huawei Ascend) are now operationally competitive for inference workloads at tier-2 Chinese cloud providers.

**3. Custom silicon is accelerating.** Google's TPU v5, Microsoft's Maia, and Meta's MTIA chips are absorbing 15–20% of internal compute demand that would otherwise represent GPU procurement. Apple Intelligence's on-device inference architecture explicitly reduces cloud GPU dependency.

**The trade:** Trimming tactical NVDA momentum to sector weight on strength, while rotating toward **infrastructure enablers** (TSMC, Broadcom, Arista) that benefit from AI buildout without bearing hyperscaler concentration risk. AVGO warrants particular attention — its custom ASIC business for Google and Meta exceeds $8B annual revenue with 65%+ gross margins.

**Dark pool signal:** Block prints in NVDA totaling $2.8B over the past 5 sessions show mixed premium/discount distribution, suggesting institutional rebalancing rather than directional positioning. Contrast with AVGO, where 87% of block prints over the past week carried above-VWAP premiums — consistent with accumulation.`,
    signals: [
      { key: 'NVDA Dark Pool Prints', value: 'Mixed premium — rebalancing signal', impact: 'neutral' },
      { key: 'AMD Market Share', value: '23% new enterprise GPU deployments', impact: 'negative' },
      { key: 'AVGO Block Prints', value: '87% above-VWAP — accumulation', impact: 'positive' },
      { key: 'Custom Silicon', value: '15–20% hyperscaler demand absorbed', impact: 'negative' },
    ]
  },
  {
    id: 3,
    title: 'The GLP-1 Trade Is Not Over — It Has Just Migrated',
    summary: 'As Novo and Lilly battle for market share, the real alpha has shifted to supply chain enablers, oral formulations, and GLP-1 obesity adjacencies.',
    sector: 'healthcare',
    timestamp: '2026-03-22T14:20:00Z',
    readTime: 5,
    tags: ['GLP-1', 'Obesity', 'Novo Nordisk', 'Eli Lilly', 'Biotech'],
    content: `The GLP-1 market has cleared its first major inflection point: from "does this work?" to "who wins the duopoly?" The answer is Novo Nordisk and Eli Lilly — and Goldman Sachs estimates the total addressable market at $130B by 2030.

But the crowded consensus trade — long NVO, long LLY — has left the more interesting risk-reward asymmetry underexplored.

**Where the alpha has migrated:**

**Supply chain bottleneck players.** Injectable GLP-1 requires specialized lipid nanoparticle manufacturing and specialized glass vials (Gerresheimer, SG Pharma). The capacity constraints are real and multi-year. West Pharmaceutical Services and Stevanato Group are effectively toll roads on GLP-1 volume growth.

**The oral formulation race.** Novo's oral semaglutide (Rybelsus) has 60% lower bioavailability than injectable — the clinical hurdle is significant. Pfizer's danuglipron failed Phase 3. But Eli Lilly's orforglipron is tracking ahead of consensus efficacy expectations. If oral bioavailability issues are solved at scale, the total addressable market expands by an estimated 3× beyond the injectable-accessible population.

**Obesity adjacency infrastructure.** Barclays estimates that 42M Americans on GLP-1 therapy by 2030 will require $18B in additional cardiac monitoring, musculoskeletal intervention (muscle mass loss is a documented side effect), and nutritional support — creating durable demand for companies like Edwards Lifesciences and Hims & Hers Health.

**The risk the market may be underpricing:** CMS reimbursement decisions. Medicare Part D GLP-1 coverage for obesity (not just diabetes) was expanded in January 2026, but the actuarial cost at full penetration ($14,000/year × 10M eligible beneficiaries = $140B annual program cost) creates political pressure that could restrict access within 24 months.

**Investment signal:** Rotate from pure NVO/LLY momentum into supply chain enablers. Entry on weakness in WEST, STVN, and structured upside in HIMS via call spreads into Q3 2026 earnings.`,
    signals: [
      { key: 'GLP-1 TAM 2030', value: '$130B — Goldman Sachs', impact: 'positive' },
      { key: 'Medicare Cost Risk', value: '$140B actuarial exposure', impact: 'negative' },
      { key: 'Oral Formulation', value: 'LLY orforglipron Phase 3 ahead', impact: 'positive' },
      { key: 'Supply Chain', value: 'WEST, STVN: toll roads on volume', impact: 'positive' },
    ]
  },
  {
    id: 4,
    title: 'Financial Sector Set for Super-Cycle as Yield Curve Steepens',
    summary: 'The 10Y-2Y spread widening to 85bps is the clearest signal in a decade for bank net interest income upgrades — and markets have not fully priced it.',
    sector: 'financials',
    timestamp: '2026-03-22T08:00:00Z',
    readTime: 4,
    tags: ['Banks', 'Yield Curve', 'NII', 'JPMorgan', 'Rate Cycle'],
    content: `The 10Y-2Y U.S. Treasury spread has widened to 85 basis points — the steepest positive slope since November 2022 — and bank equities have not fully priced this signal. History shows that bank net interest income inflections of this magnitude produce 18–24 months of earnings upgrades before consensus catches up.

Three factors are simultaneously amplifying the opportunity. First, deposit repricing lag: banks re-priced deposits aggressively during the inverted curve period; as short rates soften while long rates remain elevated, the NII spread compression reverses with a ~2 quarter lag that is only now beginning to work in banks' favor. JPMorgan's raised NII guidance of $2.5B above consensus reflects this dynamic at the largest-scale example.

Second, credit quality is holding. Commercial real estate charge-offs, widely feared to cause a regional bank crisis, are being absorbed within reserve buffers built over the 2021–2023 period. The regional bank index has recovered 85% of its SVB crisis losses while trading at 9.5× forward earnings — a structural discount to historical norms.

Third, private credit market share is an additive story for megabanks, not a zero-sum threat. JPMorgan, Goldman, and Morgan Stanley are all deploying capital into direct lending through affiliated vehicles while maintaining their traditional banking P&L — effectively running both engines simultaneously.

**The underappreciated trade:** Regional bank pairs (buying FITB/HBAN and selling CMA/ZION based on deposit base quality differential) offer more alpha per unit of risk than the crowded JPM/BAC megabank long. The pair trade neutralizes rate risk and isolates quality.

**Watchpoint:** Fed dot plot revisions at the June FOMC. If the median dot shifts from 2 to 1 2026 cuts, the curve could steepen further — a significant incremental tailwind for sector positioning.`,
    signals: [
      { key: '10Y-2Y Spread', value: '85bps — widest since Nov 2022', impact: 'positive' },
      { key: 'JPM NII Guidance', value: '+$2.5B above consensus', impact: 'positive' },
      { key: 'Regional Bank P/E', value: '9.5× forward — structural discount', impact: 'positive' },
      { key: 'Fed Dot Risk', value: 'June FOMC revision key catalyst', impact: 'neutral' },
    ]
  },
  {
    id: 5,
    title: 'Defense + Reshoring = The Industrials Supercycle Nobody Is Talking About',
    summary: 'NATO spending commitments plus domestic manufacturing capex are creating a 7–10 year earnings visibility window for select industrial franchises.',
    sector: 'industrials',
    timestamp: '2026-03-21T10:00:00Z',
    readTime: 5,
    tags: ['Defense', 'Reshoring', 'GE Aerospace', 'RTX', 'Caterpillar'],
    content: `The $985B U.S. defense authorization and NATO's collective agreement to raise member spending to 2.5% of GDP are not one-time events — they represent a structural shift in the baseline defense procurement cycle that will sustain elevated industrial capex through the early 2030s.

GE Aerospace's $220B backlog — the largest in company history — represents 7+ years of production at current rates. LEAP engine demand from the global narrow-body fleet replacement cycle (Airbus A320neo, Boeing 737 MAX) is supply-constrained, not demand-constrained, creating pricing power GE has not possessed since the pre-GFC era.

The reshoring dynamic adds a second independent tailwind. The CHIPS Act manufacturing buildout is driving demand for precision machining, environmental control systems, and industrial automation that flows directly to Emerson, Honeywell, and Parker Hannifin. Mexico nearshoring is creating infrastructure capex across railroads (Union Pacific Mexico corridor utilization at record levels), warehousing, and power systems that will persist for 5–7 years.

**The Caterpillar thesis deserves special attention.** Mining capex for copper, lithium, cobalt, and nickel has entered a structural growth phase driven by the energy transition. CAT's mining division order book extends to 2029 in many commodity segments, with autonomous haul truck orders growing at 45% annually. The company's Service Revenue stream (parts, connectivity, autonomy subscriptions) provides software-like recurring income that markets are discounting at a blended hardware multiple.

**Signal:** **Overweight Industrials**. Priority: GE, RTX, CAT, UNP. Secondary: HON, EMR. Hedge with XAR (aerospace ETF) for concentrated aerospace exposure without defense concentration risk.`,
    signals: [
      { key: 'GE Backlog', value: '$220B — 7+ year production visibility', impact: 'positive' },
      { key: 'Defense Budget', value: '$985B — NATO 2.5% GDP commitment', impact: 'positive' },
      { key: 'CAT Autonomous Mining', value: 'Order growth +45% annually', impact: 'positive' },
      { key: 'Mexico Rail Corridor', value: 'UNP at record utilization', impact: 'positive' },
    ]
  },
  {
    id: 6,
    title: 'Copper at $5.20 Is Not a Peak — It Is a New Structural Floor',
    summary: 'The copper market is entering a structural deficit driven by the energy transition, defense reshoring, and AI infrastructure that analysts are systematically underforecasting.',
    sector: 'materials',
    timestamp: '2026-03-21T06:00:00Z',
    readTime: 4,
    tags: ['Copper', 'Energy Transition', 'Freeport-McMoRan', 'Critical Minerals', 'EV'],
    content: `Copper at $5.20/lb is provoking the usual cycle-top debate among commodity skeptics — the same debate that was had at $3.50, $4.00, and $4.50 during the current supercycle. The structural demand argument deserves a more rigorous hearing.

The energy transition copper intensity cannot be wished away. A single EV requires 4× the copper of an ICE vehicle. An offshore wind turbine requires 4 metric tons. A grid battery storage system requires 12× the copper of equivalent thermal generation capacity. These are physics, not projections.

Simultaneously, supply addition is structurally constrained. Lead times from discovery to production now average 16 years. The top 20 copper deposits are older, lower-grade, and deeper than at any point in the last 30 years. Freeport-McMoRan's Grasberg mine — the world's second-largest — faces geological grade decline through 2029 that no amount of capex can remediate.

Chile, which produces 27% of global copper, is navigating a political environment that has consistently blocked new permits. The Dominga project (2.5B ton copper equivalent reserve) has been in permitting limbo for 9 years. New water allocation requirements added since 2022 create compliance costs that render marginal projects economically non-viable below $4.50/lb.

**The institutional thesis:** Copper miners are trading at 6–8× forward EBITDA versus historical norms of 8–12×. The discount reflects short-cycle investor skepticism that persistently underweights structural commodity stories until the deficit is undeniable. Freeport-McMoRan at current prices implies copper at $3.80 for valuation normalization — a 27% discount to spot that offers a wide margin of safety.

**Investment recommendation:** Long FCX, SCCO with 18-month horizon. Add physical copper ETF (CPER) for unlevered commodity exposure. Stop loss: copper break below $4.20.`,
    signals: [
      { key: 'Copper Price', value: '$5.20/lb — supply structurally constrained', impact: 'positive' },
      { key: 'FCX Implied Copper', value: 'Values copper at $3.80 — 27% discount', impact: 'positive' },
      { key: 'Chile Permitting', value: 'Dominga blocked 9 years — supply locked', impact: 'positive' },
      { key: 'EV Demand', value: '4× copper intensity vs. ICE vehicle', impact: 'positive' },
    ]
  },
]

// Mock data generators for dark-pool prints, chart markers, and sector news.
// Deterministic seeds: same inputs → same outputs for SSR/hydration.

import { DarkPoolPrint } from './sectors'

// ─── Seeded PRNG (Mulberry32) — deterministic, no hydration mismatch ─────────
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

// ─── Seed prices (shared by the demo generators below) ───────────────────────
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
//
// Phase 14 wave 29: `time` widened from `string` to `string | number`. Daily-bar
// callers pass YYYY-MM-DD strings; intraday-bar callers (3m aggregator in
// the chart route) pass Unix seconds as numbers. Both are valid lightweight-
// charts `Time` formats. Removing this constraint allowed two `as any` casts
// in `app/api/chart/[ticker]/route.ts` to be deleted.
export function generateDarkPoolMarkers(
  candles: { time: string | number; close: number }[],
  ticker: string = 'X',
) {
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

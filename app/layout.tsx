import type { Metadata, Viewport } from 'next'
import './globals.css'
import GlobalSearch from '@/components/GlobalSearch'
import Providers from '@/components/Providers'
import SafeAuth from '@/components/SafeAuth'
import ComplianceBanner from '@/components/ComplianceBanner'
import KeyboardShortcuts, { ShortcutsButton } from '@/components/KeyboardShortcuts'
import MarketStatus from '@/components/MarketStatus'
import Breadcrumbs from '@/components/Breadcrumbs'
import { SiteNavDesktop, SiteNavMobile } from '@/components/SiteNav'

export const viewport: Viewport = {
  themeColor: '#0a0a0f',
  width: 'device-width',
  initialScale: 1,
  // maximumScale removed (2026-07-10): capping zoom at 1 blocks pinch-zoom for
  // low-vision users — WCAG 1.4.4 Resize Text; flagged by the axe crawl
  // ("meta-viewport"). iOS input auto-zoom is acceptable collateral.
}

export const metadata: Metadata = {
  title: 'QUANTAN — Market Intelligence',
  description: 'Institutional-grade market intelligence across all 11 GICS sectors — real-time prices, K-line charts, dark pool data, and curated signal briefs.',
  keywords: 'stock market, sector analysis, dark pool, institutional trading, market signals',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'QUANTAN',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-bg text-white antialiased" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
        <Providers>
          {/* Skip-link — Phase 13 S2 fix (F6.1) — WCAG 2.4.1 Bypass Blocks (Level A).
              Hidden by default; visible only on keyboard focus. Allows keyboard
              and screen-reader users to skip the global navigation. */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-2 focus:bg-amber-400 focus:text-slate-950 focus:rounded focus:outline-none focus:ring-2 focus:ring-amber-300 focus:font-medium"
          >
            Skip to main content
          </a>
          {/* Global Nav — restructured 2026-08-14 (F-IA-1 + F-UI-1).
              Was: a flat `flex-wrap` row of 7 links + search + auth + status
              that collapsed into five stacked bands at 375 px and measured
              211 px tall (26 % of the viewport) while STILL not exposing
              /portfolio, /portfolio/factor-attribution, /risk/scenarios or
              /backtest. Now: a single 56 px row at every breakpoint, with the
              full destination list owned by `components/SiteNav.tsx`. */}
          <header className="sticky top-0 z-50 border-b border-slate-800/50 bg-slate-950/90 backdrop-blur-xl">
            <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
              <a href="/" className="flex items-center gap-2.5 group shrink-0">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-xs font-bold text-white shadow-lg shadow-amber-900/50 group-hover:shadow-amber-700/60 transition-shadow">
                  QU
                </div>
                <span className="font-bold text-white text-sm tracking-wide">QUANTAN</span>
                <span className="text-slate-400 text-xs hidden 2xl:block font-mono">/ Market Intelligence</span>
              </a>
              {/* Breadcrumbs only where there is room — below xl the nav's
                  aria-current already communicates location. */}
              <div className="hidden xl:flex shrink-0">
                <Breadcrumbs />
              </div>

              <SiteNavDesktop />

              <div className="flex-1" />

              <div className="hidden sm:block w-36 md:w-48 lg:w-56 xl:w-72 shrink-0">
                <GlobalSearch />
              </div>
              <ShortcutsButton />
              <div className="hidden sm:flex shrink-0">
                <MarketStatus />
              </div>
              <SafeAuth />
              <SiteNavMobile />
            </div>
          </header>
          <main id="main-content" tabIndex={-1} className="focus:outline-none">
            {children}
          </main>
          <KeyboardShortcuts />
          <ComplianceBanner />
          <footer className="border-t border-slate-800/60 mt-12 py-8">
            <div className="max-w-7xl mx-auto px-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-[9px] font-bold text-white">QU</div>
                  <span className="font-medium text-slate-400">QUANTAN</span>
                  <span className="text-slate-700" aria-hidden="true">·</span>
                  <span>Market Intelligence Platform</span>
                </div>
                <p className="text-center sm:text-right max-w-lg">
                  Data for informational purposes only — not investment advice. Dark pool panels and some signals are simulated for demonstration purposes.
                </p>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  )
}

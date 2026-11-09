import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import './globals.css'
import GlobalSearch from '@/components/GlobalSearch'
import Providers from '@/components/Providers'
import SafeAuth from '@/components/SafeAuth'
import ComplianceBanner from '@/components/ComplianceBanner'
import KeyboardShortcuts, { ShortcutsButton } from '@/components/KeyboardShortcuts'
import MarketStatus from '@/components/MarketStatus'
import Breadcrumbs from '@/components/Breadcrumbs'
import { SiteNavDesktop, SiteNavMobile, SiteNavSidebar } from '@/components/SiteNav'

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
        {/* The rule targets the Pages Router, where a font in one page loads only
            there. This is the App Router root layout, which wraps every route. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="text-white antialiased" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
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
          <SiteNavSidebar />
          <div className="workspace-frame">
            <header className="workspace-header sticky top-0 z-50">
              <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:px-6 xl:h-20 xl:gap-5 xl:px-8">
                {/* Must be a <Link>, not a raw <a>. Measured on production
                    2026-09-14 (Q-119): the raw anchor took 190.5 ms median and
                    re-issued 16 requests against the nav <Link>'s 23 ms and zero,
                    because a document navigation rebuilds the whole app shell —
                    and it also discards every bit of client state (SWR caches,
                    the open SSE stream, scroll position) that a soft nav keeps. */}
                <Link href="/" className="flex shrink-0 items-center gap-2.5 xl:hidden" aria-label="QUANTAN home">
                  <span className="workspace-logomark workspace-logomark-small" aria-hidden="true">Q<span /></span>
                  <span className="hidden text-xs font-semibold tracking-[0.12em] text-white sm:inline">QUANTAN</span>
                </Link>
                {/* Breadcrumbs only where there is room — below xl the nav's
                    aria-current already communicates location. */}
                <div className="hidden min-w-0 shrink-0 xl:flex">
                  <span className="mr-4 text-xs font-medium text-slate-400">Market intelligence</span>
                  <Breadcrumbs />
                </div>

                <SiteNavDesktop />

                <div className="hidden xl:block xl:flex-1" />

                <div className="workspace-search min-w-0 flex-1 sm:max-w-xs lg:max-w-[180px] xl:max-w-sm">
                  <GlobalSearch />
                </div>
                <div className="hidden sm:block"><ShortcutsButton /></div>
                <div className="hidden sm:flex shrink-0">
                  <MarketStatus />
                </div>
                <SafeAuth />
                <SiteNavMobile />
              </div>
            </header>
            <main id="main-content" tabIndex={-1} className="min-h-[calc(100vh-15rem)] focus:outline-none">
              {children}
            </main>
            <KeyboardShortcuts />
            <ComplianceBanner />
            <footer className="border-t border-white/[0.06] py-6">
              <div className="mx-auto max-w-[1600px] px-4 sm:px-6 xl:px-8">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
                  <div className="flex items-center gap-2">
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
          </div>
        </Providers>
      </body>
    </html>
  )
}

import type { Metadata, Viewport } from 'next'
import './globals.css'
import Link from 'next/link'
import GlobalSearch from '@/components/GlobalSearch'
import Providers from '@/components/Providers'
import SafeAuth from '@/components/SafeAuth'
import ComplianceBanner from '@/components/ComplianceBanner'
import KeyboardShortcuts from '@/components/KeyboardShortcuts'
import MarketStatus from '@/components/MarketStatus'
import Breadcrumbs from '@/components/Breadcrumbs'

export const viewport: Viewport = {
  themeColor: '#0a0a0f',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
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
          {/* Global Nav */}
          <header className="sticky top-0 z-50 border-b border-slate-800/50 bg-slate-950/90 backdrop-blur-xl">
            <div className="max-w-7xl mx-auto px-4 min-h-14 flex flex-wrap items-center justify-between gap-y-2 py-2">
              <div className="flex items-center gap-4">
                <a href="/" className="flex items-center gap-2.5 group">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-xs font-bold text-white shadow-lg shadow-amber-900/50 group-hover:shadow-amber-700/60 transition-shadow">
                    QU
                  </div>
                  <span className="font-bold text-white text-sm tracking-wide">QUANTAN</span>
                  <span className="text-slate-500 text-xs hidden lg:block font-mono">/ Market Intelligence</span>
                </a>
                <Breadcrumbs />
              </div>
              <nav className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-5">
                <Link href="/" className="text-xs font-medium text-slate-400 hover:text-white transition-colors relative group">
                  Markets
                  <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-amber-500 group-hover:w-full transition-all duration-200" />
                </Link>
                <Link href="/desk" className="text-xs font-medium text-slate-400 hover:text-white transition-colors relative group">
                  Desk
                  <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-amber-500 group-hover:w-full transition-all duration-200" />
                </Link>
                <Link href="/commodities" className="text-xs font-medium text-slate-400 hover:text-white transition-colors relative group">
                  Commodities
                  <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-amber-500 group-hover:w-full transition-all duration-200" />
                </Link>
                <Link href="/crypto/btc" className="text-xs font-medium text-slate-400 hover:text-white transition-colors relative group">
                  Crypto
                  <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-amber-500 group-hover:w-full transition-all duration-200" />
                </Link>
                <Link href="/heatmap" className="text-xs font-medium text-slate-400 hover:text-white transition-colors relative group">
                  Heatmap
                  <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-amber-500 group-hover:w-full transition-all duration-200" />
                </Link>
                <Link href="/ma-deviation" className="text-xs font-medium text-slate-400 hover:text-white transition-colors flex items-center gap-1">
                  <span>200MA</span>
                  <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono leading-none">NEW</span>
                </Link>
                <Link href="/briefs" className="text-xs font-medium text-slate-400 hover:text-white transition-colors relative group">
                  Briefs
                  <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-amber-500 group-hover:w-full transition-all duration-200" />
                </Link>
                <GlobalSearch />
                <SafeAuth />
                <MarketStatus />
              </nav>
            </div>
          </header>
          <main>{children}</main>
          <KeyboardShortcuts />
          <ComplianceBanner />
          <footer className="border-t border-slate-800/60 mt-12 py-8">
            <div className="max-w-7xl mx-auto px-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-[9px] font-bold text-white">QU</div>
                  <span className="font-medium text-slate-500">QUANTAN</span>
                  <span className="text-slate-700">·</span>
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

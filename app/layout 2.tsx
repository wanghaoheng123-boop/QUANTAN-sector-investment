import type { Metadata, Viewport } from 'next'
import './globals.css'
import Link from 'next/link'
import GlobalSearch from '@/components/GlobalSearch'

export const viewport: Viewport = {
  themeColor: '#0a0a0f',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export const metadata: Metadata = {
  title: 'Antigravity Sector Intelligence',
  description: 'Institutional-grade market intelligence across all 11 GICS sectors — real-time prices, K-line charts, dark pool data, and curated signal briefs.',
  keywords: 'stock market, sector analysis, dark pool, institutional trading, market signals',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Antigravity',
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
        {/* Global Nav */}
        <header className="sticky top-0 z-50 border-b border-slate-800/50 bg-slate-950/90 backdrop-blur-xl">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
            <a href="/" className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-xs font-bold">
                AG
              </div>
              <span className="font-bold text-white text-sm">Antigravity</span>
              <span className="text-slate-500 text-sm hidden sm:block">/ Sector Intelligence</span>
            </a>
            <nav className="flex items-center gap-6">
            <Link href="/" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Markets</Link>
            <Link href="/heatmap" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Heatmap</Link>
            <Link href="/briefs" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Briefs</Link>
            <GlobalSearch />
            <div className="flex items-center gap-1.5 bg-green-500/10 px-2 py-1 rounded-md border border-green-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                LIVE
              </div>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="border-t border-slate-800 mt-20 py-10">
          <div className="max-w-7xl mx-auto px-4 text-center text-xs text-slate-600">
            <p>Antigravity Sector Intelligence · Institutional-grade market analysis platform</p>
            <p className="mt-1">Data provided for informational purposes only. Not financial advice. Dark pool data synthesized for demonstration.</p>
          </div>
        </footer>
      </body>
    </html>
  )
}

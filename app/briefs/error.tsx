'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function BriefsErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[BriefsError]', error)
  }, [error])

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 text-center">
      <div className="text-4xl mb-4">⚠</div>
      <h1 className="text-xl font-bold text-white mb-2">Failed to load briefs</h1>
      <p className="text-sm text-slate-400 mb-6">
        {error.digest && (
          <span className="block font-mono text-xs text-slate-600 mb-2">
            ID: {error.digest}
          </span>
        )}
        {error.message || 'An unexpected error occurred.'}
      </p>
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Try again
        </button>
        <Link
          href="/"
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Markets
        </Link>
      </div>
    </div>
  )
}

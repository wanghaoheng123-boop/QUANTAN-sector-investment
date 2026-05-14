'use client'

import { useEffect } from 'react'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Page error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      {/* role="alert" + labelled heading per WCAG 2.2 SC 4.1.3. */}
      <div role="alert" aria-labelledby="page-error-heading" className="max-w-md w-full text-center space-y-6">
        <div className="text-6xl" aria-hidden="true">⚠️</div>
        <h1 id="page-error-heading" className="text-xl font-bold text-white">Something went wrong</h1>
        <p className="text-sm text-slate-400">
          {error.digest && (
            <span className="block font-mono text-xs text-slate-400 mb-2">
              Error ID: {error.digest}
            </span>
          )}
          This page encountered an unexpected error. Please try refreshing.
        </p>
        <button
          type="button"
          autoFocus
          onClick={reset}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-bg"
        >
          Try again
        </button>
        <p className="text-xs text-slate-400">
          If the problem persists, the data source may be temporarily unavailable.
        </p>
      </div>
    </div>
  )
}

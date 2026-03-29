'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[GlobalError]', error)
  }, [error])

  return (
    <html lang="en">
      <body className="bg-bg text-white min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="text-6xl">⚠️</div>
          <h1 className="text-xl font-bold text-white">Application Error</h1>
          <p className="text-sm text-slate-400">
            {error.digest && (
              <span className="block font-mono text-xs text-slate-600 mb-2">
                ID: {error.digest}
              </span>
            )}
            An unexpected error occurred while loading this page.
          </p>
          <button
            onClick={reset}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}

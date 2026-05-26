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
        {/*
          role="alert" makes screen readers announce the message
          immediately without waiting for user interaction (WCAG 2.2
          SC 4.1.3 Status Messages). The implicit politeness of role=alert
          is "assertive" — appropriate for an unrecoverable crash.
        */}
        <div role="alert" aria-labelledby="global-error-heading" className="max-w-md w-full text-center space-y-6">
          {/* Icon is decorative; the heading conveys the meaning. */}
          <div className="text-6xl" aria-hidden="true">⚠️</div>
          <h1 id="global-error-heading" className="text-xl font-bold text-white">Application Error</h1>
          <p className="text-sm text-slate-400">
            {error.digest && (
              <span className="block font-mono text-xs text-slate-400 mb-2">
                ID: {error.digest}
              </span>
            )}
            An unexpected error occurred while loading this page.
          </p>
          {/* autoFocus lands focus on the recovery action — keyboard
              users don't have to tab through the (already-broken) page
              context to reach the reset button. */}
          <button
            type="button"
            autoFocus
            onClick={reset}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-bg"
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}

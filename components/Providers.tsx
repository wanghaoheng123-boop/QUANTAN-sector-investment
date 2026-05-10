'use client'

import { SessionProvider } from 'next-auth/react'
import { Component, type ReactNode } from 'react'

class SessionErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950">
          <div className="max-w-md mx-auto px-6 py-12 text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white">Session Error</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              The authentication session could not be loaded. This may be a temporary issue — please try refreshing the page.
            </p>
            {this.state.error && (
              <p className="text-xs text-slate-600 font-mono break-all">
                {'message' in this.state.error ? (this.state.error as Error).message : 'Unknown error'}
              </p>
            )}
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Retry
            </button>
          </div>
        </div>
      )
    }
    return <SessionProvider>{this.props.children}</SessionProvider>
  }
}

export default function Providers({ children }: { children: ReactNode }) {
  return <SessionErrorBoundary>{children}</SessionErrorBoundary>
}

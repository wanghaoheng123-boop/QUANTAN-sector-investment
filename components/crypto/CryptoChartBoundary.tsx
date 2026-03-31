'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode; title?: string }

type State = { hasError: boolean; message: string }

export default class CryptoChartBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err?.message ?? 'Chart error' }
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('[CryptoChartBoundary]', err, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-center space-y-3">
          <div className="text-sm font-medium text-red-200">{this.props.title ?? 'Chart failed to render'}</div>
          <p className="text-[11px] text-red-200/70 font-mono break-all max-w-2xl mx-auto">{this.state.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="text-xs px-3 py-1.5 rounded-md bg-slate-700 text-white hover:bg-slate-600"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

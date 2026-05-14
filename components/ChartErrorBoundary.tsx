'use client'

/**
 * ChartErrorBoundary — React error boundary for chart components.
 *
 * Wraps KLineChart, EquityCurveChart, BtcQuantLab, GexChart, and any other
 * rendering-heavy chart components. Catches render-time exceptions so that a
 * single chart failure never crashes the whole page.
 *
 * Phase 12 Sprint 1 (H4): Added per DeepSeek V4 Pro QA audit finding that
 * uncaught chart render errors were taking down the entire dashboard.
 */

import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  /** Ticker or label shown in the fallback (e.g. "XLK", "Equity Curve") */
  label?: string
  /** Height of the fallback placeholder — should match the chart's expected height */
  fallbackHeight?: number
  children: React.ReactNode
}

interface State {
  hasError: boolean
  errorMessage: string | null
}

export class ChartErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, errorMessage: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message ?? 'Unknown error' }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console — replace with Sentry/OpenTelemetry in Sprint 4
    console.error('[ChartErrorBoundary] Chart render error:', {
      label: this.props.label,
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    })
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: null })
  }

  render() {
    if (this.state.hasError) {
      const height = this.props.fallbackHeight ?? 480
      const label = this.props.label ?? 'Chart'

      return (
        <div
          className="flex flex-col items-center justify-center rounded-xl border border-amber-500/20 bg-surface gap-3"
          style={{ height }}
        >
          <AlertTriangle className="w-8 h-8 text-amber-400 opacity-70" />
          <p className="text-slate-400 text-sm font-medium">
            {label} unavailable
          </p>
          {this.state.errorMessage && (
            <p className="text-slate-400 text-xs max-w-xs text-center px-4 font-mono">
              {this.state.errorMessage}
            </p>
          )}
          <button
            onClick={this.handleRetry}
            className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-white/10 text-slate-300 text-xs hover:border-amber-500/40 hover:text-amber-400 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ChartErrorBoundary

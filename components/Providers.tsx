'use client'

import { SessionProvider } from 'next-auth/react'
import { Component, type ReactNode } from 'react'

class SessionErrorBoundary extends Component<{ children: ReactNode }> {
  state = { hasError: false }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  render() {
    if (this.state.hasError) return null
    return <SessionProvider>{this.props.children}</SessionProvider>
  }
}

export default function Providers({ children }: { children: ReactNode }) {
  return <SessionErrorBoundary>{children}</SessionErrorBoundary>
}

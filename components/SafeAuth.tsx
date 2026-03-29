'use client'

import { useSession } from 'next-auth/react'
import { signIn, signOut } from 'next-auth/react'
import Link from 'next/link'
import { LogIn, LogOut, User } from 'lucide-react'

function AuthContent() {
  const { data: session, status } = useSession()

  if (status === 'loading') {
    return (
      <div className="h-8 w-20 rounded-md bg-slate-800/80 animate-pulse" aria-hidden />
    )
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-2">
        {session.user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={session.user.image}
            alt=""
            className="w-7 h-7 rounded-full border border-slate-700"
          />
        ) : (
          <span className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
            <User className="w-4 h-4 text-slate-400" />
          </span>
        )}
        <span className="text-xs text-slate-400 max-w-[100px] truncate hidden sm:inline" title={session.user.email ?? ''}>
          {session.user.name ?? session.user.email ?? 'Account'}
        </span>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/' })}
          className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-white px-2 py-1.5 rounded-md hover:bg-slate-800 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    )
  }

  return (
    <Link
      href="/auth/signin"
      className="flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 px-2.5 py-1.5 rounded-md border border-blue-500/30 hover:bg-blue-500/10 transition-colors"
    >
      <LogIn className="w-3.5 h-3.5" />
      Sign in
    </Link>
  )
}

// Wrap in error boundary in case NextAuth is not configured
import { Component, type ReactNode } from 'react'

class AuthErrorBoundary extends Component<{ children: ReactNode }> {
  state = { hasError: false }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  render() {
    if (this.state.hasError) {
      return (
        <Link
          href="/auth/signin"
          className="flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 px-2.5 py-1.5 rounded-md border border-blue-500/30 hover:bg-blue-500/10 transition-colors"
        >
          <LogIn className="w-3.5 h-3.5" />
          Sign in
        </Link>
      )
    }
    return this.props.children
  }
}

export default function SafeAuth() {
  return (
    <AuthErrorBoundary>
      <AuthContent />
    </AuthErrorBoundary>
  )
}

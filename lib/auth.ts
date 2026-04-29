import type { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'
import crypto from 'crypto'

const providers: NextAuthOptions['providers'] = []

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  )
}

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  providers.push(
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    })
  )
}

// Cached per-process random secret so repeated calls to getSecret() return the
// same value (NextAuth calls this multiple times during config resolution).
let _generatedSecret: string | null = null

// Returns the secret. In production, generates a cryptographically random secret
// if NEXTAUTH_SECRET is not configured, and logs a warning. The generated secret
// will persist for the lifetime of the serverless function instance, so sessions
// signed before a cold start will be invalidated — this is intentional to prevent
// silent session forgery when the env var is missing.
function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (secret && secret !== 'NOT-CONFIGURED-BUILD-TIME-PLACEHOLDER') {
    return secret
  }

  const isBuildTime = process.env.NEXT_PHASE === 'phase-production-build'
  if (isBuildTime) {
    // next build needs any non-empty string to avoid crashing; real secret is
    // injected at runtime via Vercel env vars.
    return 'build-time-placeholder-replaced-at-runtime'
  }

  if (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') {
    if (!_generatedSecret) {
      _generatedSecret = crypto.randomBytes(32).toString('hex')
      console.warn(
        '[auth] NEXTAUTH_SECRET is not configured. Generated a random per-instance secret. ' +
        'Sessions will be invalidated on cold starts. Set NEXTAUTH_SECRET in your Vercel ' +
        'environment variables to persist sessions across deployments.'
      )
    }
    return _generatedSecret
  }

  // Development fallback — acceptable for local use only.
  return 'dev-only-insecure-placeholder-do-not-use-in-production'
}

export function getAuthOptions(): NextAuthOptions {
  return {
    providers,
    session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
    secret: getSecret(),
    pages: { signIn: '/auth/signin' },
    callbacks: {
      async jwt({ token, user, account, profile }) {
        if (user) {
          token.email = user.email
          token.name = user.name
          token.picture = user.image
        }
        if (account && profile) {
          token.name = (profile as { name?: string }).name ?? token.name
          token.picture =
            (profile as { image?: string; avatar_url?: string }).image
            ?? (profile as { avatar_url?: string }).avatar_url
            ?? token.picture
        }
        return token
      },
      async session({ session, token }) {
        if (session.user) {
          session.user.name = (token.name as string | undefined) ?? session.user.name
          session.user.email = (token.email as string | undefined) ?? session.user.email
          session.user.image = (token.picture as string | undefined) ?? session.user.image
        }
        return session
      },
    },
  }
}

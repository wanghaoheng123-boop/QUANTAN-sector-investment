import type { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'

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

// Returns the secret or null. Never throws here — throws at request time
// via NextAuth's own validation when the placeholder is used in production.
function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[QUANTAN] NEXTAUTH_SECRET is not set. ' +
        'Generate one with: openssl rand -base64 32. ' +
        'Set it in Vercel → Project → Settings → Environment Variables.'
      )
    }
    return 'NOT-CONFIGURED-PLACEHOLDER-REPLACE-WITH-REAL-SECRET'
  }
  if (secret === 'NOT-CONFIGURED-PLACEHOLDER-REPLACE-WITH-REAL-SECRET') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[QUANTAN] NEXTAUTH_SECRET is still the placeholder value. ' +
        'Generate a real secret with: openssl rand -base64 32. ' +
        'Set it in Vercel → Project → Settings → Environment Variables.'
      )
    }
  }
  return secret
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

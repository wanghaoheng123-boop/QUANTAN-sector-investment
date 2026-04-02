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

// Returns the secret, falling back to a build-safe placeholder.
// NextAuth will gracefully reject unauthenticated requests if the secret is invalid.
function getSecret(): string {
  return process.env.NEXTAUTH_SECRET ?? 'NOT-CONFIGURED-BUILD-TIME-PLACEHOLDER'
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

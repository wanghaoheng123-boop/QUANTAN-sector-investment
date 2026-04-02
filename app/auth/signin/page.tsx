import Link from 'next/link'
import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import SignInButtons from './SignInButtons'
import { getAuthOptions } from '@/lib/auth'

export const metadata = {
  title: 'Sign in · QUANTAN',
}

export default async function SignInPage() {
  const session = await getServerSession(getAuthOptions())
  if (session) redirect('/')

  const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  const hasGitHub = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
  const hasSecret = Boolean(process.env.NEXTAUTH_SECRET)
  const baseUrl = process.env.NEXTAUTH_URL || 'https://your-deployment.vercel.app'

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/50 p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-sm font-bold">
            AG
          </div>
          <h1 className="text-xl font-bold text-white">Sign in (optional)</h1>
          <p className="text-sm text-slate-500">
            The rest of the app works without an account. OAuth only syncs your watchlist key in the browser when you are logged in (JWT — no user database in this repo).
          </p>
        </div>

        {!hasGoogle && !hasGitHub ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-200/90 space-y-4">
            <div>
              <p className="font-medium text-amber-100 mb-2">OAuth not configured</p>
              <p className="text-amber-200/70">
                Add environment variables locally (<code className="text-xs bg-slate-950 px-1 py-0.5 rounded">.env.local</code>) or in{' '}
                <strong className="text-amber-100">Vercel → Project → Settings → Environment Variables</strong> (Production + Preview), then redeploy.
              </p>
            </div>

            <div className="rounded-md bg-slate-950/60 border border-slate-800 p-3 text-xs text-slate-400 space-y-2">
              <p className="text-slate-300 font-medium">Required for NextAuth</p>
              <ul className="list-disc pl-4 space-y-1 font-mono text-[11px]">
                <li>
                  <span className="text-slate-500">NEXTAUTH_SECRET=</span> run <code className="text-slate-300">openssl rand -base64 32</code>
                </li>
                <li>
                  <span className="text-slate-500">NEXTAUTH_URL=</span>
                  <span className="text-slate-300"> {baseUrl}</span>
                </li>
              </ul>
              <p className="text-slate-300 font-medium pt-2">At least one provider</p>
              <ul className="list-disc pl-4 space-y-1 font-mono text-[11px]">
                <li>GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — redirect: <code className="text-slate-300">…/api/auth/callback/google</code></li>
                <li>GITHUB_ID / GITHUB_SECRET — callback: <code className="text-slate-300">…/api/auth/callback/github</code></li>
              </ul>
            </div>

            <p className="text-xs text-amber-200/60">
              Copy variable names from <code className="bg-slate-950 px-1 rounded">.env.example</code> in the repo. See README → OAuth setup for Google Cloud / GitHub OAuth app steps.
            </p>

            <Link href="/" className="inline-block text-blue-400 hover:text-blue-300 text-sm font-medium">
              ← Back to markets
            </Link>
          </div>
        ) : !hasSecret ? (
          <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200/90">
            <p className="font-medium text-red-100 mb-2">NEXTAUTH_SECRET missing</p>
            <p className="text-red-200/70 mb-3">
              Providers are set, but sessions will fail until you set <code className="text-xs bg-slate-950 px-1 py-0.5 rounded">NEXTAUTH_SECRET</code> in Vercel or{' '}
              <code className="text-xs bg-slate-950 px-1 py-0.5 rounded">.env.local</code> and redeploy.
            </p>
            <SignInButtons hasGoogle={hasGoogle} hasGitHub={hasGitHub} />
          </div>
        ) : (
          <SignInButtons hasGoogle={hasGoogle} hasGitHub={hasGitHub} />
        )}

        <p className="text-xs text-slate-600 text-center leading-relaxed">
          By signing in you agree that this platform is for information only and does not provide investment advice.
          See footer disclaimer on the main site.
        </p>
      </div>
    </div>
  )
}

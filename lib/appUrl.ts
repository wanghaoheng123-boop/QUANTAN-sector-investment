/** Canonical base URL for server-side same-origin API fetches (briefs SSR, etc.). */
export function appBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`
  if (process.env.NODE_ENV === 'development') {
    const port = process.env.PORT?.trim() || '3000'
    return `http://127.0.0.1:${port}`
  }
  return 'https://quantan.vercel.app'
}

/**
 * Prefix for same-origin API calls when the app uses `basePath` in next.config.js.
 * Set NEXT_PUBLIC_BASE_PATH in env (e.g. `/app`) so client fetches hit `/app/api/...`.
 */
export function apiUrl(path: string): string {
  const raw =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_BASE_PATH
      ? String(process.env.NEXT_PUBLIC_BASE_PATH).replace(/\/$/, '')
      : ''
  const p = path.startsWith('/') ? path : `/${path}`
  return `${raw}${p}`
}

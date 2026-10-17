/**
 * The GitHub REST caller both alert runners share. Throws on any non-2xx, so a
 * caller that must keep going (the heartbeat's per-workflow loop, a thread read)
 * catches explicitly rather than by accident.
 */
const API = 'https://api.github.com'

export const makeGh = (token) => async (path, init = {}) => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

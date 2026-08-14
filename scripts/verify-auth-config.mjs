/**
 * Verifies the DEPLOYED auth configuration from the outside.
 *
 * Run: npm run verify:auth
 * Against another target: AUTH_BASE_URL=https://your-preview.vercel.app npm run verify:auth
 *
 * WHY THIS EXISTS
 * ───────────────
 * Auth here is optional by design: with no providers the app still works signed-out and
 * /auth/signin renders a tidy setup panel. That graceful degradation is exactly what makes a
 * misconfiguration invisible — the page looks deliberate whether you configured nothing or
 * configured it WRONG. On 2026-08-14 that panel had been naming GITHUB_ID / GITHUB_SECRET
 * while lib/auth.ts reads GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET, so following the on-screen
 * instructions produced two variables nothing reads and no feedback at all.
 *
 * This script asks the deployment what it ACTUALLY has, so "did my env vars take effect?" is
 * a one-command question with a real answer instead of a page that looks the same either way.
 *
 * It reads only public endpoints and never reads or prints a secret value.
 *
 * SCOPE LIMIT, STATED UP FRONT: NEXTAUTH_SECRET is NOT assertable from out here.
 * /api/auth/session answers 200 to a valid cookie, a garbage cookie and no cookie alike
 * (measured 2026-08-14), so any "check" built on it is a guaranteed pass. This script
 * reports that item as unknown and points at the Vercel log event instead of pretending.
 *
 * Exit 0 = everything checkable is configured. Exit 1 = something to fix (each finding
 * prints the fix). Exit 0 does NOT by itself mean NEXTAUTH_SECRET is set — see above.
 */
const base = (process.env.AUTH_BASE_URL || 'https://quantan.vercel.app').replace(/\/$/, '')

const pass = (m) => (console.log(`  ✓ ${m}`), true)
const fail = (m, fix) => (console.error(`  ✗ ${m}`), fix && console.error(`      → ${fix}`), false)
const warn = (m) => (console.log(`  ! ${m}`), true)

async function get(path, init) {
  const res = await fetch(`${base}${path}`, { redirect: 'manual', ...init })
  const text = await res.text().catch(() => '')
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { res, status: res.status, text, json, headers: res.headers }
}

async function main() {
  console.log(`Auth config verification → ${base}\n`)
  let okAll = true

  // ── 1. The NextAuth route is mounted at all ────────────────────────────────
  console.log('NextAuth route')
  const providers = await get('/api/auth/providers')
  okAll &= providers.status === 200
    ? pass(`GET /api/auth/providers → 200`)
    : fail(
        `GET /api/auth/providers → ${providers.status}`,
        'The [...nextauth] route is not responding. Check the deployment built app/api/auth/[...nextauth]/route.ts.'
      )

  // ── 2. Which providers are actually live ──────────────────────────────────
  console.log('\nProviders')
  const configured = providers.json && typeof providers.json === 'object'
    ? Object.keys(providers.json)
    : []

  if (configured.length === 0) {
    okAll = fail(
      'ZERO providers configured — sign-in is unavailable',
      'Set at least one pair in Vercel → Project → Settings → Environment Variables (Production), then REDEPLOY:\n' +
        '        GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET\n' +
        '        GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET\n' +
        '      Note the CLIENT_ in the GitHub names — lib/auth.ts reads GITHUB_CLIENT_ID, not GITHUB_ID.'
    )
  } else {
    pass(`configured: ${configured.join(', ')}`)
    for (const id of configured) {
      const cb = providers.json[id]?.callbackUrl
      if (!cb) { warn(`${id}: no callbackUrl reported`); continue }
      // The callback URL must match what is registered with the provider, and it is derived
      // from NEXTAUTH_URL — a mismatch here is the classic redirect_uri_mismatch failure.
      const expected = `${base}/api/auth/callback/${id}`
      okAll &= cb === expected
        ? pass(`${id} callback: ${cb}`)
        : fail(
            `${id} callback is ${cb}, expected ${expected}`,
            `Set NEXTAUTH_URL=${base} in Vercel and register EXACTLY "${expected}" with the provider.`
          )
    }
  }

  // ── 3. NEXTAUTH_URL sanity, inferred from what the server reports ─────────
  console.log('\nNEXTAUTH_URL')
  const csrf = await get('/api/auth/csrf')
  okAll &= csrf.status === 200 && typeof csrf.json?.csrfToken === 'string'
    ? pass('GET /api/auth/csrf → 200 with a token')
    : fail(`GET /api/auth/csrf → ${csrf.status}`, 'NextAuth cannot issue a CSRF token; check NEXTAUTH_URL and NEXTAUTH_SECRET.')

  // ── 4. NEXTAUTH_SECRET — deliberately NOT asserted from out here ──────────
  //
  // An earlier draft "verified" this by sending back the csrf cookie and asserting
  // /api/auth/session returned 200. Measured 2026-08-14, that endpoint returns 200 for a
  // valid cookie, a garbage cookie, an empty cookie, and no cookie at all — so the check
  // discriminated nothing and would have printed a ✓ on a deployment with no secret set.
  // A check that cannot fail is worse than no check: it manufactures confidence. Reporting
  // it as unknown is the honest result.
  //
  // The authoritative signal is server-side: lib/auth.ts emits a structured critical event
  // when the secret is missing, which is visible in the Vercel runtime logs.
  console.log('\nNEXTAUTH_SECRET (informational — not assertable from outside)')
  warn('cannot be determined from a public endpoint while signed out')
  console.log('      → authoritative check: Vercel → Project → Logs, filter for  auth.secret_missing')
  console.log('         (lib/auth.ts logs that event, severity "critical", on every cold start')
  console.log('          when NEXTAUTH_SECRET is unset — it then signs with a random')
  console.log('          per-instance key, so sessions die on each cold start.)')
  console.log('      → to set it:  openssl rand -base64 32   then add NEXTAUTH_SECRET in')
  console.log('         Vercel (Production) and redeploy.')

  // ── 5. The setup panel must name the variables the code reads ─────────────
  // Regression guard for the 2026-08-14 defect, checked against the LIVE page.
  console.log('\nSetup panel env names')
  const signin = await get('/auth/signin')
  const visible = signin.text.replace(/<[^>]*>/g, ' ')
  const bogus = /\bGITHUB_(?!CLIENT_)(ID|SECRET)\b/.exec(visible)
  okAll &= !bogus
    ? pass('sign-in page names GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET')
    : fail(
        `sign-in page shows "${bogus[0]}", which nothing reads`,
        'lib/auth.ts gates on GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET — fix app/auth/signin/page.tsx.'
      )

  console.log('')
  if (okAll) {
    console.log('Auth configuration OK.')
    process.exit(0)
  }
  console.error('Auth configuration incomplete — see the → lines above.')
  process.exit(1)
}

main().catch((e) => {
  console.error(`verify:auth failed to run: ${e.message}`)
  process.exit(1)
})

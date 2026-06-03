/** @type {import('next').NextConfig} */
const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  /** Never cache Next API routes in the service worker — stale 451/empty bodies break crypto. */
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
        handler: 'NetworkOnly',
      },
    ],
  },
})

// Phase 13 S2 fix (F7.6): security headers per OWASP Secure Headers Project /
// Mozilla Observatory baseline. CSP added in report-only mode first so any
// console violations can be surveyed before enforcing strict mode.
const SECURITY_HEADERS = [
  // HSTS: 2-year max-age, include subdomains, preload-list eligible.
  // Only effective on HTTPS — Vercel already serves HTTPS-only.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  // Block MIME-type sniffing. Browsers must respect declared Content-Type.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Disallow embedding in iframes (clickjacking defense).
  // Use frame-ancestors in CSP for finer control if needed later.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Referrer privacy: send origin for cross-origin nav, full URL same-origin.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable powerful features the dashboard never uses.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  // CSP report-only (advisory). Tighten + flip to enforcing in S3 once
  // surveyed. Allows: self for everything; Google Fonts CSS; eval'd JS in
  // dev only; data: img URLs (used for some embed previews); HTTPS images.
  {
    key: 'Content-Security-Policy-Report-Only',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
]

const nextConfig = {
  images: {
    // Phase 15 Q-029 / R7-C-4 (Security, CWE-918 SSRF amplification):
    //
    // Prior config `hostname: '**'` made Next.js' image-optimization endpoint
    // a generic image proxy: `/_next/image?url=https://internal/admin&w=...`
    // could pull responses from arbitrary endpoints through our origin. The
    // Next.js security advisory and Vercel docs both prescribe an explicit
    // allowlist; '**' is documented as "use only for prototypes."
    //
    // Current callers of <Image> in this codebase: NONE (verified 2026-05-23
    // via `grep -rln "from 'next/image'" app components hooks`). The allowlist
    // below pre-approves the hostnames we EXPECT to need when <Image> adoption
    // begins:
    //   • lh3.googleusercontent.com    — Google OAuth profile photos
    //   • avatars.githubusercontent.com — GitHub OAuth profile photos
    //   • s.yimg.com / *.yimg.com       — Yahoo Finance logos + thumbnails
    //   • finance.yahoo.com             — Yahoo embed previews
    //   • static2.finviz.com            — Finviz sector logos (if/when used)
    //   • images.financialcontent.com   — Common finance CDN for news thumbs
    //
    // To add a new host: append a pattern + require security-track reviewer
    // ack in the PR (Phase 15 S1 gate). Do NOT re-introduce '**'.
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      { protocol: 'https', hostname: 's.yimg.com' },
      { protocol: 'https', hostname: '*.yimg.com' },
      { protocol: 'https', hostname: 'finance.yahoo.com' },
      { protocol: 'https', hostname: 'static2.finviz.com' },
      { protocol: 'https', hostname: 'images.financialcontent.com' },
    ],
  },
  serverExternalPackages: ['yahoo-finance2'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ]
  },
}

module.exports = withPWA(nextConfig)

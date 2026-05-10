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
    // TODO Phase 13 F7.6 (Security): restrict remotePatterns to specific
    // image CDNs (currently allows ANY https host — SSRF amplification risk).
    // Known callers: yahoo finance logo CDNs, news provider thumbs.
    remotePatterns: [
      { protocol: 'https', hostname: '**' }
    ]
  },
  // Prevent Next.js from bundling yahoo-finance2 and its broken ESM shim.
  // Resolved by Node.js natively at runtime instead.
  // Next.js 14 uses experimental.serverComponentsExternalPackages
  experimental: {
    serverComponentsExternalPackages: ['yahoo-finance2'],
  },
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

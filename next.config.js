/** @type {import('next').NextConfig} */
const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
})

const nextConfig = {
  images: {
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
}

module.exports = withPWA(nextConfig)

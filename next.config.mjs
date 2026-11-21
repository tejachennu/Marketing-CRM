/** Safety headers on every page and API answer. */
const everywhere = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  // Voice notes (microphone) and photos (camera) are recorded in the app itself; nothing else may ask
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(), payment=(self "https://checkout.razorpay.com")' },
]
/** The signed-in app and sign-in pages can never be shown inside another site's frame (click-jacking). */
const noFraming = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  devIndicators: false,
  // The PDF and Word readers for the AI knowledge base run from node_modules as they are (tested that way)
  serverExternalPackages: ['unpdf', 'mammoth'],
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: everywhere },
      ...['/dashboard', '/dashboard/:path*', '/login', '/signup', '/forgot-password', '/reset-password', '/set-password', '/auth/:path*'].map((source) => ({ source, headers: noFraming })),
    ]
  },
}

export default nextConfig

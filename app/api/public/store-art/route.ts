import { NextRequest } from 'next/server'
import { storeArt } from '@/lib/commerce/store-art'

export const runtime = 'nodejs'

// GET ?kind=banner|logo|tile&c=<colour>&name=<business or category>&n=<design>: a picture made for a store page
export async function GET(request: NextRequest) {
  const svg = storeArt(new URL(request.url).searchParams)
  if (!svg) return new Response('Unknown picture', { status: 404 })
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
      // Shown as a picture only: no scripts, nothing loaded from elsewhere
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

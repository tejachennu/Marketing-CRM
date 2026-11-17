import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore } from '@/lib/commerce/storefront'
import { robotsTxt } from '@/lib/commerce/store-seo'

export const runtime = 'nodejs'

// GET /robots.txt on a store's own domain (rewritten here): let Google in and point it at the site map
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = await loadStore(getSupabaseAdminClient(), slug).catch(() => null)
  if (!page) return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } })
  return new Response(robotsTxt(page), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}

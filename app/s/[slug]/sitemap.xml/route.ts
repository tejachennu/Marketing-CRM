import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore } from '@/lib/commerce/storefront'
import { sitemapXml } from '@/lib/commerce/store-seo'

export const runtime = 'nodejs'

// GET /s/<slug>/sitemap.xml (and /sitemap.xml on the store's own domain): every page for Google
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = await loadStore(getSupabaseAdminClient(), slug).catch(() => null)
  if (!page) return new Response('Not found', { status: 404 })
  return new Response(sitemapXml(page), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}

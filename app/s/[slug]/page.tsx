import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore, storeView } from '@/lib/commerce/storefront'
import { Storefront } from './storefront'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const page = await loadStore(getSupabaseAdminClient(), slug).catch(() => null)
  if (!page) return { title: 'Store' }
  const name = page.organization.name
  const description = page.settings.tagline || `Shop at ${name} online. Order for pick up or delivery.`
  const image = page.settings.banners[0]?.image || page.settings.logo || page.products.find((p) => p.image)?.image
  return { title: name, description, openGraph: { title: name, description, ...(image ? { images: [image] } : {}) } }
}

/** A business's online store: /s/<workspace slug>, ?c=<category> to open on one category. */
export default async function StorePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ c?: string }> }) {
  const { slug } = await params
  const { c } = await searchParams
  const page = await loadStore(getSupabaseAdminClient(), slug)
  if (!page) notFound()
  const view = storeView(page)
  return <Storefront store={view} appUrl={(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')} startCategory={view.categories.some((x) => x.name === c) ? c! : null} />
}

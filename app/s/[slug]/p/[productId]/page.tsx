import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore, storeView } from '@/lib/commerce/storefront'
import { formatMoney } from '@/lib/commerce/commerce-utils'
import { Storefront } from '../../storefront'

export const dynamic = 'force-dynamic'

async function load(slug: string, productId: string) {
  const page = await loadStore(getSupabaseAdminClient(), slug).catch(() => null)
  const product = page?.products.find((p) => p.id === productId) || null
  return { page, product }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; productId: string }> }): Promise<Metadata> {
  const { slug, productId } = await params
  const { page, product } = await load(slug, productId)
  if (!page || !product) return { title: 'Product' }
  const description = (product.description || `${product.title} at ${page.organization.name}. Order online for pick up or delivery.`).slice(0, 200)
  const title = `${product.title} · ${formatMoney(product.price, product.currency)} · ${page.organization.name}`
  return { title, description, openGraph: { title, description, ...(product.image ? { images: [product.image] } : {}) } }
}

/** One product's own page: /s/<slug>/p/<product id>, or /p/<product id> on the store's own domain. */
export default async function ProductPage({ params }: { params: Promise<{ slug: string; productId: string }> }) {
  const { slug, productId } = await params
  const { page, product } = await load(slug, productId)
  if (!page || !product) notFound()
  const view = storeView(page)
  const ownDomain = (await headers()).get('x-store-via-domain') === '1'
  // For search engines: what it is, what it costs, whether it is in stock
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    ...(product.image ? { image: [product.image] } : {}),
    ...(product.description ? { description: product.description.slice(0, 1000) } : {}),
    category: product.category,
    offers: { '@type': 'Offer', price: product.price, priceCurrency: product.currency, availability: product.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', seller: { '@type': 'Organization', name: page.organization.name } },
  }
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
      <Storefront store={view} appUrl={(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')} basePath={ownDomain ? '' : `/s/${page.organization.slug}`} productId={product.id} startCategory={null} />
    </>
  )
}

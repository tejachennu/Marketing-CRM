import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore, storeView } from '@/lib/commerce/storefront'
import { storeBase } from '@/lib/commerce/store-seo'
import { Storefront } from './storefront'
import { domainSite, loadSite } from '@/lib/salon/website-store'
import { BusinessSite } from '@/components/salon-site/business-site'
import { siteMetadata } from '@/components/salon-site/site-metadata'

/** On a business's own domain: its Front Desk website when that is what the domain opens. */
async function websiteForDomain(slug: string) {
  const db = getSupabaseAdminClient()
  const target = await domainSite(db, slug).catch(() => null)
  return target?.opens === 'website' ? loadSite(db, target.slug).catch(() => null) : null
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const website = await websiteForDomain(slug)
  if (website) return siteMetadata(website, `https://${slug}/`)
  const page = await loadStore(getSupabaseAdminClient(), slug).catch(() => null)
  if (!page) return { title: 'Store' }
  const name = page.organization.name
  const description = page.settings.tagline || `Shop at ${name} online. Order for pick up or delivery.`
  const image = page.settings.banners[0]?.image || page.settings.logo || page.products.find((p) => p.image)?.image
  const url = `${storeBase(page)}/`
  return {
    title: page.settings.tagline ? `${name} · ${page.settings.tagline}` : name,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', url, siteName: name, title: name, description, ...(image ? { images: [image] } : {}) },
    twitter: { card: image ? 'summary_large_image' : 'summary', title: name, description, ...(image ? { images: [image] } : {}) },
  }
}

/** A business's online store: /s/<workspace slug>, ?c=<category> to open on one category. */
export default async function StorePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ c?: string }> }) {
  const { slug } = await params
  const { c } = await searchParams
  const website = await websiteForDomain(slug)
  if (website) return <BusinessSite {...website} hours={website.page.setup.settings} bookHref="/book" storeLink={null} />
  const page = await loadStore(getSupabaseAdminClient(), slug)
  if (!page) notFound()
  const view = storeView(page)
  const ownDomain = (await headers()).get('x-store-via-domain') === '1'
  return <Storefront store={view} basePath={ownDomain ? '' : `/s/${page.organization.slug}`} appUrl={(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')} startCategory={view.categories.some((x) => x.name === c) ? c! : null} />
}

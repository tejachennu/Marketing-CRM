import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadSite } from '@/lib/salon/website-store'
import { BusinessSite } from '@/components/salon-site/business-site'
import { siteMetadata } from '@/components/salon-site/site-metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const data = await loadSite(getSupabaseAdminClient(), slug).catch(() => null)
  return data ? siteMetadata(data, `${(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')}/v/${slug}`) : { title: 'Not found' }
}

/** A Front Desk business's website on WAMA's address: /v/<workspace slug>. Own domains show the same (see /s/[slug]). */
export default async function BusinessWebsite({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = await loadSite(getSupabaseAdminClient(), slug)
  if (!data) notFound()
  return <BusinessSite {...data} hours={data.page.setup.settings} bookHref={`/b/${data.view.slug}`} />
}

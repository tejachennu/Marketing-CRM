import type { Metadata } from 'next'
import type { SiteData } from '@/lib/salon/website-store'

/** Title, description and sharing preview for the Front Desk website. */
export function siteMetadata(data: SiteData, url: string): Metadata {
  const { view, site } = data
  const where = view.address ? view.address.split('\n')[0] : ''
  const description = site.tagline || `${view.business}${where ? `, ${where}` : ''}. ${view.services.length} services. Book online in a minute.`
  const image = site.cover || site.gallery[0] || view.logo || undefined
  return {
    title: site.tagline ? `${view.business} · ${site.tagline}` : view.business,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', url, siteName: view.business, title: view.business, description, ...(image ? { images: [image] } : {}) },
    twitter: { card: image ? 'summary_large_image' : 'summary', title: view.business, description, ...(image ? { images: [image] } : {}) },
  }
}

/**
 * Google and share previews for a store: its address (own domain or WAMA's), the site map and robots.txt.
 */

import type { StorePage } from './storefront'
import { STORE_PAGES, pageText } from './store-pages'

const appUrl = () => String(process.env.NEXT_PUBLIC_APP_URL || 'https://wamacrm.magnetora.in').replace(/\/$/, '')

/** Where the store lives: https://its-own-domain, or WAMA's /s/<slug>. */
export function storeBase(page: Pick<StorePage, 'organization'>, viaOwnDomain = false): string {
  if (page.organization.domain && viaOwnDomain) return `https://${page.organization.domain}`
  if (page.organization.domain) return `https://${page.organization.domain}`
  return `${appUrl()}/s/${page.organization.slug}`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Every page Google should know: home, each product, each info page. */
export function sitemapXml(page: StorePage, now = new Date()): string {
  const base = storeBase(page)
  const s = page.settings
  const urls = [
    { loc: `${base}/`, priority: '1.0' },
    ...page.products.map((p) => ({ loc: `${base}/p/${p.id}`, priority: '0.8' })),
    ...STORE_PAGES.filter((k) => pageText(k, s.pages, { name: page.organization.name, about: s.about, phone: s.phone, whatsapp: s.whatsapp, address: s.address })).map((k) => ({ loc: `${base}/info/${k}`, priority: '0.3' })),
  ]
  const day = now.toISOString().slice(0, 10)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc><lastmod>${day}</lastmod><priority>${u.priority}</priority></url>`).join('\n')}\n</urlset>\n`
}

export function robotsTxt(page: StorePage): string {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${storeBase(page)}/sitemap.xml\n`
}

/**
 * The Front Desk business website in the database: its settings (salon_settings.website), and everything the page
 * shows, found by the workspace's address (/v/<slug>) or by the business's own domain. Rules in website.ts.
 * Server only.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { bookableDays, loadBookingPage, publicView, type BookingPage } from './booking-page'
import { latestPosts } from '../instagram/store'
import { getAiAccess } from '../ai-access'
import { readSite, domainOpens, type SiteSettings } from './website'
import { readStorefront } from '../commerce/storefront'

/** supabase/migrations/20261209_front_desk_website.sql word for word. */
export const SITE_SQL = `-- The Front Desk business website: cover photo, gallery, words, colour, which parts to show, and which site the
-- business's own domain opens (website or online store). Safe to run more than once. The app runs it on its own.
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS website JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
`

export const SITE_LOCK = 724519035
export const siteSchemaSetup = createAutoSetup('Front Desk website', (connectionString) => runMigrationSql(connectionString, SITE_SQL, SITE_LOCK))

export async function withSiteSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = siteSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, /website/)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, /website/); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

export async function loadSiteSettings(db: any, organizationId: string): Promise<SiteSettings> {
  const { data, error } = await withSiteSchema(() => db.from('salon_settings').select('website').eq('organization_id', organizationId).maybeSingle())
  return readSite(error ? null : data?.website)
}

export async function saveSiteSettings(db: any, organizationId: string, site: SiteSettings): Promise<void> {
  const { error } = await withSiteSchema(() => db.from('salon_settings').upsert({ organization_id: organizationId, website: site, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' }))
  if (error) throw new Error('The website could not be saved. Try again.')
}

const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/

/** Is the online store of this workspace switched on? */
function storeOn(org: any): boolean {
  return org?.enable_commerce !== false && readStorefront(org?.storefront).enabled
}

/**
 * What a business's own domain opens: 'website' (with the workspace slug), 'store', or null. The store page
 * (/s/<domain>) asks this first.
 */
export async function domainSite(db: any, domain: string): Promise<{ opens: 'website' | 'store'; slug: string } | null> {
  const host = String(domain || '').toLowerCase()
  if (!DOMAIN.test(host)) return null
  const { data: org } = await db.from('organizations').select('*').eq('store_domain', host).maybeSingle()
  if (!org) return null
  const site = await loadSiteSettings(db, org.id)
  const page = site.enabled ? await loadBookingPage(db, org.slug).catch(() => null) : null
  const opens = domainOpens({ website: Boolean(page), store: storeOn(org), choice: site.domainShows })
  return opens ? { opens, slug: org.slug } : null
}

export interface SiteData {
  page: BookingPage
  view: ReturnType<typeof publicView>
  site: SiteSettings
  average: number
  count: number
  reviews: { rating: number; comment: string; name: string; at: string }[]
  plans: any[]
  reviewLink: string | null
  /** The business's online store link, when its store is on */
  storeLink: string | null
  /** Days the booking form offers */
  days: string[]
  /** The connected Instagram account's latest posts, when the website shows them */
  instagramPosts: { id: string; image: string; link: string; caption: string }[]
  /** The AI chat shows on the website (switched on, and the AI can answer) */
  chat: boolean
}

/** Why the website's AI chat cannot answer right now, in plain words for the owner; null when it can. */
export async function siteChatProblem(db: any, org: any): Promise<string | null> {
  if (!org) return 'Workspace not found.'
  if (org.enable_ai === false) return 'AI replies are switched off for this workspace (Settings → AI).'
  const ai = await getAiAccess(db, org.id, org).catch(() => null)
  if (!ai?.allowed) return ai?.reason || 'AI is not available right now.'
  return null
}

/** Everything the website shows, by the workspace slug; null when the website (or Front Desk) is off. */
export async function loadSite(db: any, slug: string): Promise<SiteData | null> {
  const page = await loadBookingPage(db, slug).catch(() => null)
  if (!page) return null
  const site = await loadSiteSettings(db, page.organization.id)
  if (!site.enabled) return null
  const [feedback, plans, org, instagram] = await Promise.all([
    db.from('salon_feedback').select('rating, comment, customer_name, created_at').eq('organization_id', page.organization.id).order('created_at', { ascending: false }).limit(500),
    db.from('salon_membership_plans').select('name, price, validity_days, discount_percent, credit, sessions, colour').eq('organization_id', page.organization.id).eq('active', true).order('price'),
    db.from('organizations').select('*').eq('id', page.organization.id).maybeSingle(),
    // Cached on the account for 30 minutes, so the website does not ask Instagram on every visit
    site.instagramLive ? latestPosts(db, page.organization.id).catch(() => ({ posts: [] })) : Promise.resolve({ posts: [] }),
  ])
  const instagramPosts = ((instagram as any).posts || [] as any[])
    .filter((p: any) => /^https:\/\//.test(String(p?.image || '')) && /^https:\/\//.test(String(p?.link || '')))
    .slice(0, 8).map((p: any) => ({ id: String(p.id), image: String(p.image), link: String(p.link), caption: String(p.caption || '').slice(0, 200) }))
  const ratings = (feedback.data || []) as { rating: number; comment: string | null; customer_name: string | null; created_at: string }[]
  const average = ratings.length ? Math.round((ratings.reduce((s, r) => s + r.rating, 0) / ratings.length) * 10) / 10 : 0
  // Good reviews with words, first name only
  const reviews = ratings.filter((r) => r.rating >= 4 && String(r.comment || '').trim().length >= 8).slice(0, 6)
    .map((r) => ({ rating: r.rating, comment: String(r.comment).trim().slice(0, 280), name: String(r.customer_name || 'A customer').split(' ')[0], at: r.created_at }))
  const reviewLink = /^https:\/\//.test(String(page.setup.settings.review_link || '')) ? String(page.setup.settings.review_link) : null
  return {
    page, view: publicView(page), site, average, count: ratings.length, reviews, plans: plans.error ? [] : plans.data || [], reviewLink,
    storeLink: storeOn(org.data) ? `/s/${page.organization.slug}` : null,
    days: bookableDays(page.setup.settings),
    instagramPosts,
    chat: site.chat && !(await siteChatProblem(db, org.data)),
  }
}

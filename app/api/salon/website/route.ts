import { NextRequest, NextResponse } from 'next/server'
import { badRequest, loadSalonSettings, salonAccess } from '@/lib/salon/server'
import { takesAppointments } from '@/lib/salon/appointments-switch'
import { readSite } from '@/lib/salon/website'
import { loadSiteSettings, saveSiteSettings, siteChatProblem } from '@/lib/salon/website-store'
import { readStorefront } from '@/lib/commerce/storefront'
import { logChange } from '@/lib/salon/change-log'
import { accountFor } from '@/lib/instagram/store'

export const runtime = 'nodejs'

/** The workspace's slug and whether its online store is on (the domain may open either). */
async function about(db: any, organizationId: string) {
  const [{ data: org }, ig, settings] = await Promise.all([
    db.from('organizations').select('*').eq('id', organizationId).maybeSingle(),
    accountFor(db, organizationId).catch(() => null),
    loadSalonSettings(db, organizationId).catch(() => null),
  ])
  return {
    slug: org?.slug || '', storeOn: org?.enable_commerce !== false && readStorefront(org?.storefront).enabled, domain: org?.store_domain || null,
    // The connected Instagram account (its latest posts can show on the website)
    instagram: ig ? { connected: true, username: String(ig.username || '') } : { connected: false, username: '' },
    // Why the AI chat would not show on the website right now (null when it works)
    chatProblem: await siteChatProblem(db, org),
    // What the website's buttons need (Buttons on your website): appointments on, a phone number, an address
    takesAppointments: takesAppointments(settings),
    hasPhone: String(settings?.phone || '').replace(/\D/g, '').length >= 10,
    hasAddress: Boolean(String(settings?.address || '').trim()),
  }
}

// GET ?organizationId=: the Front Desk website settings (Setup → Website and booking)
export async function GET(request: NextRequest) {
  const access = await salonAccess(request, new URL(request.url).searchParams.get('organizationId'))
  if (!access.ok) return access.response
  const { db, organizationId } = access.ctx
  return NextResponse.json({ site: await loadSiteSettings(db, organizationId), ...(await about(db, organizationId)) })
}

// PUT { organizationId, site }: save them (managers and up)
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  if (!body?.site || typeof body.site !== 'object') return badRequest('Nothing to save.')
  const { db, organizationId } = access.ctx
  const site = readSite(body.site)
  try {
    await saveSiteSettings(db, organizationId, site)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  await logChange(access.ctx, { area: 'business', action: 'changed', details: { website: 'changed' } }).catch(() => null)
  return NextResponse.json({ success: true, site, ...(await about(db, organizationId)) })
}

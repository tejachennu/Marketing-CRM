import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { addDomain, cleanDomain, domainStatus, removeDomain, vercelConfig, withStoreDomainSchema } from '@/lib/commerce/store-domain'

export const runtime = 'nodejs'

const appUrl = (request: NextRequest) => (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')

async function current(db: any, organizationId: string) {
  return withStoreDomainSchema(() => db.from('organizations').select('id, slug, store_domain').eq('id', organizationId).maybeSingle())
}

function answer(request: NextRequest, org: any, status: Awaited<ReturnType<typeof domainStatus>>) {
  return NextResponse.json({
    available: Boolean(vercelConfig()),
    ourLink: org?.slug ? `${appUrl(request)}/s/${org.slug}` : null,
    ...status,
    link: status.domain ? `https://${status.domain}` : null,
  })
}

// GET ?organizationId=: the store's address: ours, or the business's own domain and where it stands
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  const { data: org, error } = await current(db, organizationId!)
  if (error || !org) return NextResponse.json({ error: error?.message || 'Workspace not found' }, { status: 500 })
  return answer(request, org, await domainStatus(org.store_domain || null))
}

// PUT { organizationId, domain }: connect the business's own domain (admins)
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const organizationId = body?.organizationId || null
  const access = await verifyOrgAccess(request, organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const cleaned = cleanDomain(body?.domain)
  if ('error' in cleaned) return NextResponse.json({ error: cleaned.error, field: 'domain' }, { status: 400 })
  const domain = cleaned.domain
  const db = getSupabaseAdminClient()
  const { data: org, error } = await current(db, organizationId)
  if (error || !org) return NextResponse.json({ error: error?.message || 'Workspace not found' }, { status: 500 })

  // Another business on WAMA already uses it
  const { data: taken } = await db.from('organizations').select('id').eq('store_domain', domain).neq('id', organizationId).maybeSingle()
  if (taken) return NextResponse.json({ error: 'This domain is already used by another store on WAMA.', field: 'domain' }, { status: 409 })

  if (org.store_domain !== domain) {
    const added = await addDomain(domain)
    if (!added.ok) return NextResponse.json({ error: added.error, field: 'domain' }, { status: 400 })
    const saved = await db.from('organizations').update({ store_domain: domain }).eq('id', organizationId)
    if (saved.error) {
      await removeDomain(domain).catch(() => null)
      const clash = /duplicate|unique/i.test(saved.error.message || '')
      return NextResponse.json({ error: clash ? 'This domain is already used by another store on WAMA.' : 'The domain could not be saved. Please try again.' }, { status: clash ? 409 : 500 })
    }
    // The old domain stops pointing at this store
    if (org.store_domain) await removeDomain(org.store_domain).catch(() => null)
  }
  return answer(request, org, await domainStatus(domain))
}

// DELETE { organizationId }: back to our address (admins)
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const organizationId = body?.organizationId || new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  const { data: org, error } = await current(db, organizationId)
  if (error || !org) return NextResponse.json({ error: error?.message || 'Workspace not found' }, { status: 500 })
  if (org.store_domain) {
    await removeDomain(org.store_domain).catch(() => null)
    const saved = await db.from('organizations').update({ store_domain: null }).eq('id', organizationId)
    if (saved.error) return NextResponse.json({ error: 'The domain could not be removed. Please try again.' }, { status: 500 })
  }
  return answer(request, org, await domainStatus(null))
}

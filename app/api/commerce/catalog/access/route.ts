import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { exchangeLoginCode, inspectToken, isGraphId } from '@/lib/commerce/meta-catalog'

const MIGRATION = 'supabase/migrations/20261017_meta_catalog_token.sql'

function appCredentials() {
  return { id: process.env.NEXT_PUBLIC_META_APP_ID || '1747554262928162', secret: process.env.META_APP_SECRET }
}

/** Whether a database error means the meta_catalog_token column has not been added yet. */
function isMissingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error) && (error!.code === '42703' || error!.code === 'PGRST204' || /meta_catalog_token/.test(error!.message || ''))
}

/**
 * POST: finish "Connect catalog with Meta". The business granted catalog_management in Meta's window;
 * the code from that window becomes the token every catalog call of this store uses.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const organizationId = String(body?.organizationId || '')
    if (!organizationId) return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })

    const auth = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const code = String(body?.code || '').trim()
    if (!code) return NextResponse.json({ error: 'Meta did not return a login code. Try again.' }, { status: 400 })

    let token: string
    try {
      token = await exchangeLoginCode(code, appCredentials())
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || 'Meta did not exchange the login code.' }, { status: 400 })
    }

    const access = await inspectToken(token, appCredentials())
    if (!access?.valid || !access.scopes.includes('catalog_management')) {
      return NextResponse.json(
        { error: 'Meta did not give catalog access. In Meta’s window, allow access to your catalog, then try again.' },
        { status: 422 }
      )
    }

    const db = getSupabaseAdminClient()
    const { data: org } = await db.from('organizations').select('meta_catalog_id').eq('id', organizationId).maybeSingle()
    // One catalog shared and none linked yet: use it
    const granted = (access.targets.catalog_management || []).filter(isGraphId)
    const linkCatalog = !isGraphId(String(org?.meta_catalog_id || '').trim()) && granted.length === 1 ? granted[0] : null

    const { error } = await db
      .from('organizations')
      .update({ meta_catalog_token: token, ...(linkCatalog ? { meta_catalog_id: linkCatalog } : {}), updated_at: new Date().toISOString() })
      .eq('id', organizationId)
    if (error) {
      if (isMissingColumn(error)) {
        return NextResponse.json({ error: `Run ${MIGRATION} in the Supabase SQL editor first.` }, { status: 409 })
      }
      return NextResponse.json({ error: `Could not save the catalog access: ${error.message}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, catalogIds: granted, linkedCatalogId: linkCatalog })
  } catch (err: any) {
    console.error('[API Commerce Catalog Access POST] Error:', err)
    return NextResponse.json({ error: err?.message || 'Catalog access could not be saved' }, { status: 500 })
  }
}

/** DELETE: forget the catalog connection; catalog calls go back to using the WhatsApp connection. */
export async function DELETE(request: NextRequest) {
  try {
    const organizationId = new URL(request.url).searchParams.get('organizationId') || ''
    if (!organizationId) return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })

    const auth = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { error } = await getSupabaseAdminClient()
      .from('organizations')
      .update({ meta_catalog_token: null, updated_at: new Date().toISOString() })
      .eq('id', organizationId)
    if (error && !isMissingColumn(error)) {
      return NextResponse.json({ error: `Could not remove the catalog access: ${error.message}` }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[API Commerce Catalog Access DELETE] Error:', err)
    return NextResponse.json({ error: err?.message || 'Catalog access could not be removed' }, { status: 500 })
  }
}

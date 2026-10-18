import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { forgetCatalog } from '@/lib/commerce/catalog-sync'
import {
  canEditCatalog,
  createCatalog,
  deleteCatalog,
  describeCatalogError,
  getCatalog,
  getCatalogCredentials,
  getWabaOwnerId,
  getWhatsAppCredentials,
  connectCatalogWithEither,
  whatsappHasCatalog,
  inspectToken,
  isGraphId,
  listOwnedCatalogs,
  listWabaCatalogs,
  renameCatalog,
  type MetaCatalog,
  type TokenAccess,
} from '@/lib/commerce/meta-catalog'

async function loadOrganization(organizationId: string) {
  const { data } = await getSupabaseAdminClient().from('organizations').select('*').eq('id', organizationId).single()
  return data as Record<string, any> | null
}

function appCredentials() {
  return { id: process.env.NEXT_PUBLIC_META_APP_ID, secret: process.env.META_APP_SECRET }
}

/** The business portfolio catalogs are created in: the one that owns the linked catalog, else the one the token was granted. */
function findBusinessId(linked: MetaCatalog | null, access: TokenAccess | null): string | null {
  const candidate = linked?.business?.id || access?.targets.business_management?.[0] || ''
  return isGraphId(candidate) ? candidate : null
}

// GET: the store's catalog as Meta sees it, and what this WhatsApp connection may do with it
export async function GET(request: NextRequest) {
  try {
    const organizationId = new URL(request.url).searchParams.get('organizationId')
    if (!organizationId) return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })

    const auth = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const org = await loadOrganization(organizationId)
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    if (!org.whatsapp_api_token) return NextResponse.json({ error: 'WhatsApp is not connected. Connect it in Settings first.' }, { status: 400 })

    const credentials = getCatalogCredentials(org)
    const linkedId = isGraphId(String(org.meta_catalog_id || '').trim()) ? String(org.meta_catalog_id).trim() : null

    let linkedError: string | null = null
    const [connected, linked, access] = await Promise.all([
      // null: Meta would not say which catalog is connected to the WhatsApp account
      listWabaCatalogs(getWhatsAppCredentials(org)).catch(() => null),
      linkedId
        ? getCatalog(credentials, linkedId).catch((error) => {
            linkedError = describeCatalogError(error).message
            return null
          })
        : null,
      inspectToken(credentials.token, appCredentials(), credentials.version),
    ])

    // Where a new catalog goes: the linked catalog's owner, the granted business, or the WhatsApp account's owner
    const businessId = findBusinessId(linked, access) || (await getWabaOwnerId(org))
    const owned = businessId ? await listOwnedCatalogs(credentials, businessId).catch(() => []) : []

    const connectedIds = new Set((connected || []).map((catalog) => String(catalog.id)))
    // An empty list is not proof: a catalog connected in WhatsApp Manager can be missing from it, while
    // the number's cart settings (which need a connected catalog) show one is there
    const connectionUnknown = connected !== null && connected.length === 0 && (await whatsappHasCatalog(org, null)) === true
    const catalogs = new Map<string, { id: string; name: string; product_count: number; connected: boolean }>()
    for (const catalog of [...(connected || []), ...owned, ...(linked ? [linked] : [])]) {
      const id = String(catalog.id)
      if (!catalogs.has(id)) catalogs.set(id, { id, name: catalog.name || 'Catalog', product_count: catalog.product_count || 0, connected: connectedIds.has(id) })
    }

    return NextResponse.json({
      linkedCatalogId: linkedId,
      linked: linked ? { id: String(linked.id), name: linked.name || 'Catalog', product_count: linked.product_count || 0 } : null,
      linkedError,
      // Whether the linked catalog is the one connected to the WhatsApp account
      connected: linkedId && connected && !connectionUnknown ? connectedIds.has(linkedId) : null,
      // false: Meta would not list the account's catalog, so `connected` on each catalog is unknown
      connectionKnown: connected !== null && !connectionUnknown,
      catalogs: [...catalogs.values()],
      businessId,
      canEdit: canEditCatalog(access, linkedId),
      canCreate: access ? access.valid && access.scopes.includes('catalog_management') && access.scopes.includes('business_management') : null,
      // Catalog calls use a separate "Connect catalog with Meta" connection rather than the WhatsApp one
      catalogConnection: Boolean(String(org.meta_catalog_token || '').trim()),
    })
  } catch (err: any) {
    console.error('[API Commerce Catalog GET] Error:', err)
    return NextResponse.json({ error: describeCatalogError(err).message }, { status: 500 })
  }
}

// POST: connect a catalog to the WhatsApp account, or create one
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { organizationId, action } = body
    if (!organizationId) return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })

    const auth = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    if (!['connect', 'create', 'unlink', 'rename', 'delete'].includes(action)) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

    const org = await loadOrganization(organizationId)
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    if (!org.whatsapp_api_token) return NextResponse.json({ error: 'WhatsApp is not connected. Connect it in Settings first.' }, { status: 400 })
    const credentials = getCatalogCredentials(org)

    const linkCatalog = async (catalogId: string) => {
      const { error } = await getSupabaseAdminClient()
        .from('organizations')
        .update({ meta_catalog_id: catalogId, updated_at: new Date().toISOString() })
        .eq('id', organizationId)
      if (error) throw error
    }

    // Unlink, rename and delete apply only to this store's own catalog
    if (action === 'unlink' || action === 'rename' || action === 'delete') {
      const linkedId = String(org.meta_catalog_id || '').trim()
      if (!isGraphId(linkedId)) return NextResponse.json({ error: 'No catalog is linked to this store.' }, { status: 400 })
      const unlink = async () => {
        const { error } = await getSupabaseAdminClient()
          .from('organizations')
          .update({ meta_catalog_id: null, updated_at: new Date().toISOString() })
          .eq('id', organizationId)
        if (error) throw error
      }

      if (action === 'rename') {
        const name = String(body.name || '').trim()
        try {
          await renameCatalog(credentials, linkedId, name)
        } catch (error) {
          return NextResponse.json({ error: describeCatalogError(error).message }, { status: 422 })
        }
        return NextResponse.json({ success: true, catalogId: linkedId, name })
      }

      // Meta has no API to disconnect a catalog from a WhatsApp account (its reference: deleting on
      // /{waba}/product_catalogs is not supported). This store stops using it; the business disconnects
      // it in WhatsApp Manager if it should also leave WhatsApp.
      if (action === 'unlink') {
        await unlink()
        return NextResponse.json({ success: true, catalogId: linkedId, unlinked: true })
      }

      // Deleting removes the catalog and all its items in Meta for good, so the caller repeats its ID
      if (String(body.confirm || '') !== linkedId) {
        return NextResponse.json({ error: 'Confirm by sending the catalog ID.' }, { status: 400 })
      }
      try {
        await deleteCatalog(credentials, linkedId)
      } catch (error) {
        return NextResponse.json({ error: describeCatalogError(error).message }, { status: 422 })
      }
      await unlink()
      const productsReset = await forgetCatalog(getSupabaseAdminClient(), organizationId, linkedId).catch(() => 0)
      return NextResponse.json({ success: true, deleted: linkedId, productsReset })
    }

    if (action === 'connect') {
      const catalogId = String(body.catalogId || '').trim()
      if (!isGraphId(catalogId)) return NextResponse.json({ error: 'Enter the catalog ID shown in Commerce Manager.' }, { status: 400 })
      try {
        await connectCatalogWithEither(org, catalogId)
      } catch (error) {
        return NextResponse.json({ error: describeCatalogError(error).message + ' You can also connect it yourself in WhatsApp Manager → Account tools → Catalog.' }, { status: 422 })
      }
      await linkCatalog(catalogId)
      return NextResponse.json({ success: true, catalogId, connected: true })
    }

    // Create a catalog in the business portfolio, then connect it to the WhatsApp account
    let businessId = String(body.businessId || '').trim()
    if (businessId && !isGraphId(businessId)) {
      return NextResponse.json({ error: 'Enter the business portfolio ID shown in Meta Business Suite → Settings → Business info.' }, { status: 400 })
    }
    if (!businessId) {
      const linkedId = String(org.meta_catalog_id || '').trim()
      const [linked, access] = await Promise.all([
        isGraphId(linkedId) ? getCatalog(credentials, linkedId).catch(() => null) : null,
        inspectToken(credentials.token, appCredentials(), credentials.version),
      ])
      businessId = findBusinessId(linked, access) || (await getWabaOwnerId(org)) || ''
    }
    if (!businessId) {
      return NextResponse.json({ error: 'Meta did not say which business portfolio owns your WhatsApp account. Reconnect WhatsApp in Settings and try again.' }, { status: 400 })
    }

    let catalogId: string
    try {
      catalogId = await createCatalog(credentials, businessId, String(body.name || `${org.name || 'Store'} catalog`))
    } catch (error) {
      return NextResponse.json({ error: describeCatalogError(error).message }, { status: 422 })
    }
    // Saved before connecting: the catalog now exists, and connecting can be retried
    await linkCatalog(catalogId)

    try {
      await connectCatalogWithEither(org, catalogId)
      return NextResponse.json({ success: true, catalogId, connected: true })
    } catch (error) {
      return NextResponse.json({ success: true, catalogId, connected: false, connectError: describeCatalogError(error).message + ' You can also connect it yourself in WhatsApp Manager → Account tools → Catalog.' })
    }
  } catch (err: any) {
    console.error('[API Commerce Catalog POST] Error:', err)
    return NextResponse.json({ error: err.message || 'The catalog could not be changed' }, { status: 500 })
  }
}

/**
 * Meta's catalog endpoints, as documented for the Marketing API and the WhatsApp Business Platform:
 *
 *   POST /{business-id}/owned_product_catalogs        create a catalog
 *   GET|POST /{waba-id}/product_catalogs              the catalog connected to a WhatsApp account
 *   POST /{catalog-id}/items_batch                    create, update and delete items
 *   GET  /{catalog-id}/check_batch_request_status     how a batch went
 *   GET  /{catalog-id}/products                       the items, with WhatsApp's review of each
 *   GET|POST /{phone-number-id}/whatsapp_commerce_settings
 *
 * Every call is made with the organization's own access token, so Meta decides what it may touch.
 * Editing a catalog needs the `catalog_management` permission (and `business_management` to create one).
 */

import { metaRequest, type MetaCredentials } from '@/lib/flows/meta-client'
import type { CatalogBatchRequest } from './catalog-items'

const DEFAULT_GRAPH_VERSION = 'v25.0'

/** Meta accepts 5,000 items a call and recommends staying under 3,000. */
export const MAX_BATCH_ITEMS = 1000
const MAX_CATALOG_PAGES = 50 // 5,000 products

const CATALOG_FIELDS = 'id,name,vertical,product_count'
const ITEM_FIELDS = 'id,retailer_id,name,description,price,sale_price,currency,image_url,url,availability,inventory'
/** Asked for first; an API version that lacks one of them falls back to ITEM_FIELDS. */
const ITEM_FIELDS_WITH_REVIEW = `${ITEM_FIELDS},brand,condition,origin_country,wa_compliance_category,review_status,errors`

export type CatalogErrorKind = 'token' | 'permission' | 'rate_limit' | 'not_found' | 'timeout' | 'invalid'

export interface MetaCatalog {
  id: string
  name: string
  vertical?: string
  product_count?: number
  business?: { id: string; name?: string }
}

/** Graph object IDs are numeric. Anything else must never reach a request path. */
export function isGraphId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{5,25}$/.test(value)
}

/**
 * The access the organization gave this CRM for its catalog: the catalog connection when it made one
 * ("Connect catalog with Meta"), otherwise the WhatsApp connection. A catalog call needs only the
 * token; some need the account or number too.
 */
export function getCatalogCredentials(organization: Record<string, any> | null | undefined): MetaCredentials {
  const token = String(organization?.meta_catalog_token || organization?.whatsapp_api_token || '').trim()
  if (!token) throw new Error('WhatsApp is not connected. Connect it in Settings first.')
  const version = String(organization?.whatsapp_graph_api_version || '')
  return {
    token,
    version: /^v\d+\.\d+$/.test(version) ? version : DEFAULT_GRAPH_VERSION,
    businessAccountId: String(organization?.whatsapp_business_account_id || '').trim(),
    phoneNumberId: String(organization?.whatsapp_phone_number_id || '').trim(),
  }
}

function requireId(value: unknown, what: string): string {
  const id = String(value ?? '').trim()
  if (!isGraphId(id)) throw new Error(`${what} must be the numeric ID shown in Meta Business Suite.`)
  return id
}

/** Why a catalog call failed, in words the store owner can act on. */
export function describeCatalogError(error: any): { kind: CatalogErrorKind; message: string } {
  const detail = error?.details?.[0] || {}
  const code = Number(detail.code)
  const raw = String(error?.message || 'Meta did not accept the request.')

  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return { kind: 'timeout', message: 'Meta did not answer in time. Try again in a moment.' }
  }
  if (code === 190) {
    return { kind: 'token', message: 'The WhatsApp connection has expired or was removed. Reconnect WhatsApp in Settings.' }
  }
  if (code === 200 || code === 10 || code === 3 || code === 294) {
    return {
      kind: 'permission',
      message: 'This WhatsApp connection is not allowed to manage the catalog. Reconnect WhatsApp and give access to the catalog, or use an access token that has the catalog_management permission.',
    }
  }
  if ([4, 17, 32, 613, 80008, 80009, 80014].includes(code)) {
    return { kind: 'rate_limit', message: 'Meta is receiving too many catalog updates right now. Wait a minute and try again.' }
  }
  if (code === 100 && /does not exist|cannot be loaded|missing permission/i.test(raw)) {
    return { kind: 'not_found', message: 'Meta could not open this catalog. Check the catalog ID, and that this WhatsApp connection has access to it.' }
  }
  return { kind: 'invalid', message: raw }
}

function form(values: Record<string, string>): { method: 'POST'; body: URLSearchParams } {
  return { method: 'POST', body: new URLSearchParams(values) }
}

// ── Catalogs ────────────────────────────────────────────────────────────────

/** The catalog connected to the WhatsApp Business account. WhatsApp allows one. */
export async function listWabaCatalogs(credentials: MetaCredentials, fetcher: typeof fetch = fetch): Promise<MetaCatalog[]> {
  const wabaId = requireId(credentials.businessAccountId, 'The WhatsApp Business Account ID')
  const response = await metaRequest(credentials, `${wabaId}/product_catalogs?fields=${CATALOG_FIELDS}`, {}, fetcher)
  return response?.data || []
}

export async function getCatalog(credentials: MetaCredentials, catalogId: string, fetcher: typeof fetch = fetch): Promise<MetaCatalog> {
  return metaRequest(credentials, `${requireId(catalogId, 'The catalog ID')}?fields=${CATALOG_FIELDS},business`, {}, fetcher)
}

/** Catalogs owned by a business portfolio. Needs `business_management` and `catalog_management`. */
export async function listOwnedCatalogs(credentials: MetaCredentials, businessId: string, fetcher: typeof fetch = fetch): Promise<MetaCatalog[]> {
  const response = await metaRequest(credentials, `${requireId(businessId, 'The business portfolio ID')}/owned_product_catalogs?fields=${CATALOG_FIELDS}&limit=100`, {}, fetcher)
  return response?.data || []
}

export async function createCatalog(credentials: MetaCredentials, businessId: string, name: string, fetcher: typeof fetch = fetch): Promise<string> {
  const catalogName = name.trim().slice(0, 100)
  if (!catalogName) throw new Error('Give the catalog a name.')
  const created = await metaRequest(
    credentials,
    `${requireId(businessId, 'The business portfolio ID')}/owned_product_catalogs`,
    form({ name: catalogName, vertical: 'commerce' }),
    fetcher
  )
  if (!isGraphId(String(created?.id || ''))) throw new Error('Meta did not return the new catalog.')
  return String(created.id)
}

/** Connect a catalog to the WhatsApp Business account, so its items can be sent and ordered in chats. */
export async function connectCatalog(credentials: MetaCredentials, catalogId: string, fetcher: typeof fetch = fetch): Promise<void> {
  const wabaId = requireId(credentials.businessAccountId, 'The WhatsApp Business Account ID')
  const connected = await metaRequest(credentials, `${wabaId}/product_catalogs`, form({ catalog_id: requireId(catalogId, 'The catalog ID') }), fetcher)
  if (connected?.success !== true) throw new Error('Meta did not confirm that the catalog was connected.')
}

/** Rename a catalog. Needs `catalog_management`. */
export async function renameCatalog(credentials: MetaCredentials, catalogId: string, name: string, fetcher: typeof fetch = fetch): Promise<void> {
  const catalogName = name.trim().slice(0, 100)
  if (!catalogName) throw new Error('Give the catalog a name.')
  const result = await metaRequest(credentials, requireId(catalogId, 'The catalog ID'), form({ name: catalogName }), fetcher)
  if (result?.success !== true) throw new Error('Meta did not confirm the new name.')
}

/** Delete a catalog and every item in it, in Meta. Cannot be undone. Needs `catalog_management`. */
export async function deleteCatalog(credentials: MetaCredentials, catalogId: string, fetcher: typeof fetch = fetch): Promise<void> {
  const result = await metaRequest(credentials, requireId(catalogId, 'The catalog ID'), { method: 'DELETE' }, fetcher)
  if (result?.success !== true) throw new Error('Meta did not confirm that the catalog was deleted.')
}

/**
 * Exchange the code from a Facebook Login for Business window for an access token. Server only:
 * it sends the app secret. The code is valid for 30 seconds.
 */
export async function exchangeLoginCode(
  code: string,
  app: { id?: string; secret?: string },
  version: string = DEFAULT_GRAPH_VERSION,
  fetcher: typeof fetch = fetch
): Promise<string> {
  if (!app.id || !app.secret) throw new Error('META_APP_SECRET is not configured on the server.')
  const query = new URLSearchParams({ client_id: app.id, client_secret: app.secret, code: String(code || '') })
  const response = await fetcher(`https://graph.facebook.com/${version}/oauth/access_token?${query.toString()}`, { signal: AbortSignal.timeout(20000) })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.access_token) throw new Error(data?.error?.message || 'Meta did not exchange the login code.')
  return String(data.access_token)
}

// ── Cart and catalog buttons on the phone number ────────────────────────────

export interface CommerceSettings {
  is_cart_enabled: boolean
  is_catalog_visible: boolean
}

export async function getCommerceSettings(credentials: MetaCredentials, fetcher: typeof fetch = fetch): Promise<CommerceSettings | null> {
  const phoneNumberId = requireId(credentials.phoneNumberId, 'The Phone Number ID')
  const response = await metaRequest(credentials, `${phoneNumberId}/whatsapp_commerce_settings`, {}, fetcher)
  const settings = response?.data?.[0]
  return settings ? { is_cart_enabled: settings.is_cart_enabled === true, is_catalog_visible: settings.is_catalog_visible === true } : null
}

export async function setCommerceSettings(credentials: MetaCredentials, settings: Partial<CommerceSettings>, fetcher: typeof fetch = fetch): Promise<void> {
  const phoneNumberId = requireId(credentials.phoneNumberId, 'The Phone Number ID')
  // Meta documents these as query parameters
  const query = new URLSearchParams()
  if (typeof settings.is_cart_enabled === 'boolean') query.set('is_cart_enabled', String(settings.is_cart_enabled))
  if (typeof settings.is_catalog_visible === 'boolean') query.set('is_catalog_visible', String(settings.is_catalog_visible))
  if ([...query.keys()].length === 0) return
  const response = await metaRequest(credentials, `${phoneNumberId}/whatsapp_commerce_settings?${query.toString()}`, { method: 'POST' }, fetcher)
  if (response?.success !== true) throw new Error('Meta did not confirm the change.')
}

// ── Items ───────────────────────────────────────────────────────────────────

export interface ItemResult {
  errors: string[]
  warnings: string[]
}

export interface BatchResult {
  /** One per call that Meta accepted. Used to ask how the batch went. */
  handles: string[]
  /** The handle each item went out under, by retailer ID. Absent when its call was rejected outright. */
  handleByItem: Map<string, string>
  /** What Meta said about individual items straight away, by retailer ID. */
  items: Map<string, ItemResult>
  /** Set when a whole call failed; the items in it were not sent. */
  failed: Map<string, string>
}

function messages(list: any): string[] {
  return (Array.isArray(list) ? list : [])
    .map((entry: any) => String(entry?.message || '').trim())
    .filter(Boolean)
    .slice(0, 5)
}

/**
 * Send create/update/delete requests to a catalog. Meta takes them in, answers with a handle and
 * processes them in the background (usually within a couple of minutes).
 */
export async function sendItemsBatch(
  credentials: MetaCredentials,
  catalogId: string,
  requests: CatalogBatchRequest[],
  fetcher: typeof fetch = fetch
): Promise<BatchResult> {
  const id = requireId(catalogId, 'The catalog ID')
  const result: BatchResult = { handles: [], handleByItem: new Map(), items: new Map(), failed: new Map() }

  for (let start = 0; start < requests.length; start += MAX_BATCH_ITEMS) {
    const chunk = requests.slice(start, start + MAX_BATCH_ITEMS)
    try {
      const response = await metaRequest(
        credentials,
        `${id}/items_batch`,
        form({ item_type: 'PRODUCT_ITEM', allow_upsert: 'true', requests: JSON.stringify(chunk) }),
        fetcher
      )
      const handle = String(response?.handles?.[0] || '')
      if (handle) result.handles.push(handle)

      for (const status of Array.isArray(response?.validation_status) ? response.validation_status : []) {
        const retailerId = String(status?.retailer_id || '')
        if (!retailerId) continue
        result.items.set(retailerId, { errors: messages(status.errors), warnings: messages(status.warnings) })
      }
      for (const request of chunk) {
        const retailerId = String(request.data.id)
        if (handle) result.handleByItem.set(retailerId, handle)
        // No handle means Meta took nothing in from this call
        else if (!result.items.get(retailerId)?.errors.length) result.failed.set(retailerId, 'Meta did not take the update in. Try again.')
      }
    } catch (error) {
      const { message } = describeCatalogError(error)
      for (const request of chunk) result.failed.set(String(request.data.id), message)
      // A token or permission problem will fail every remaining chunk the same way
      for (const request of requests.slice(start + MAX_BATCH_ITEMS)) result.failed.set(String(request.data.id), message)
      break
    }
  }

  return result
}

export interface BatchStatus {
  finished: boolean
  status: string
  /** Why Meta turned items down, by retailer ID. */
  errors: Map<string, string[]>
  warnings: Map<string, string[]>
  /** Items Meta did not take, including any it gave no reason for. */
  invalidIds: Set<string>
}

export async function checkBatch(credentials: MetaCredentials, catalogId: string, handle: string, fetcher: typeof fetch = fetch): Promise<BatchStatus> {
  const id = requireId(catalogId, 'The catalog ID')
  const response = await metaRequest(
    credentials,
    `${id}/check_batch_request_status?handle=${encodeURIComponent(handle)}&load_ids_of_invalid_requests=true`,
    {},
    fetcher
  )
  const data = response?.data?.[0] || {}
  const status = String(data.status || '').toLowerCase()

  const group = (list: any): Map<string, string[]> => {
    const grouped = new Map<string, string[]>()
    for (const entry of Array.isArray(list) ? list : []) {
      const retailerId = String(entry?.id || '')
      const message = String(entry?.message || '').trim()
      if (!retailerId || !message) continue
      const current = grouped.get(retailerId) || []
      if (current.length < 5) grouped.set(retailerId, [...current, message])
    }
    return grouped
  }

  const errors = group(data.errors)
  const invalidIds = new Set<string>([...(Array.isArray(data.ids_of_invalid_requests) ? data.ids_of_invalid_requests.map(String) : []), ...errors.keys()])
  return { finished: status === 'finished', status, errors, warnings: group(data.warnings), invalidIds }
}

async function readItems(credentials: MetaCredentials, firstPath: string, fetcher: typeof fetch): Promise<any[]> {
  const items: any[] = []
  let path: string | null = firstPath
  // Follow Graph API paging so catalogs with more than 100 products are read completely
  for (let page = 0; path && page < MAX_CATALOG_PAGES; page++) {
    const response: any = await metaRequest(credentials, path, {}, fetcher)
    items.push(...(response?.data || []))
    const after: string | undefined = response?.paging?.next ? response?.paging?.cursors?.after : undefined
    path = after ? `${firstPath}&after=${encodeURIComponent(after)}` : null
  }
  return items
}

/** Every item in a catalog, with WhatsApp's review status where the API version provides it. */
export async function fetchCatalogItems(credentials: MetaCredentials, catalogId: string, fetcher: typeof fetch = fetch): Promise<any[]> {
  const id = requireId(catalogId, 'The catalog ID')
  try {
    return await readItems(credentials, `${id}/products?fields=${ITEM_FIELDS_WITH_REVIEW}&limit=100`, fetcher)
  } catch (error: any) {
    // "Invalid parameter": a field this Graph API version does not know. The basic fields are enough to sell.
    if (Number(error?.details?.[0]?.code) !== 100 || describeCatalogError(error).kind === 'not_found') throw error
    return readItems(credentials, `${id}/products?fields=${ITEM_FIELDS}&limit=100`, fetcher)
  }
}

/** Look a few items up by SKU. Never throws: a slow or failing lookup returns what it has. */
export async function fetchCatalogItemsBySku(credentials: MetaCredentials, catalogId: string, skus: string[], fetcher: typeof fetch = fetch): Promise<any[]> {
  if (!isGraphId(catalogId)) return []
  const found: any[] = []
  await Promise.all(
    skus.slice(0, 10).map(async (sku) => {
      try {
        const filter = encodeURIComponent(JSON.stringify({ retailer_id: { eq: sku } }))
        const response = await fetcher(`https://graph.facebook.com/${credentials.version}/${catalogId}/products?fields=${ITEM_FIELDS}&filter=${filter}&limit=1`, {
          headers: { Authorization: `Bearer ${credentials.token}` },
          signal: AbortSignal.timeout(4000),
        })
        if (!response.ok) return
        const item = (await response.json())?.data?.[0]
        if (item && String(item.retailer_id) === sku) found.push(item)
      } catch {
        // Best effort only
      }
    })
  )
  return found
}

// ── What the access token may do ────────────────────────────────────────────

export interface TokenAccess {
  valid: boolean
  scopes: string[]
  /** The objects each permission was granted for. A permission granted for everything has no entry. */
  targets: Record<string, string[]>
}

/**
 * Ask Meta what a token was granted, using this app's own credentials.
 * Returns null when it cannot be told (no app credentials here, or a token issued to another app).
 */
export async function inspectToken(
  token: string,
  app: { id?: string; secret?: string },
  version: string = DEFAULT_GRAPH_VERSION,
  fetcher: typeof fetch = fetch
): Promise<TokenAccess | null> {
  if (!token || !app.id || !app.secret) return null
  try {
    const response = await metaRequest(
      { token: `${app.id}|${app.secret}`, version, businessAccountId: '', phoneNumberId: '' },
      `debug_token?input_token=${encodeURIComponent(token)}`,
      {},
      fetcher
    )
    const data = response?.data
    if (!data || !Array.isArray(data.scopes)) return null
    const targets: Record<string, string[]> = {}
    for (const entry of Array.isArray(data.granular_scopes) ? data.granular_scopes : []) {
      if (entry?.scope && Array.isArray(entry.target_ids)) targets[String(entry.scope)] = entry.target_ids.map(String)
    }
    return { valid: data.is_valid !== false, scopes: data.scopes.map(String), targets }
  } catch {
    return null
  }
}

/** Whether the token may change a catalog: true, false, or null when Meta would not say. */
export function canEditCatalog(access: TokenAccess | null, catalogId?: string | null): boolean | null {
  if (!access) return null
  if (!access.valid || !access.scopes.includes('catalog_management')) return false
  const granted = access.targets.catalog_management
  return !granted || !catalogId || granted.includes(String(catalogId))
}

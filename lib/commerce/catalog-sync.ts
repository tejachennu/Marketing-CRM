/**
 * Keeps `commerce_products` and the organization's Meta catalog in step, in both directions:
 * products saved in the dashboard are sent to the catalog, and the catalog (with WhatsApp's review
 * of each item) is copied back. The database client is passed in so the rules can be tested.
 */

import {
  getCatalogItemDefaults,
  getCatalogProblems,
  getCatalogSync,
  getProductAttributes,
  toCatalogProductRow,
  toDeleteRequest,
  toUpsertRequest,
  type CatalogProductRow,
  type CatalogSync,
} from './catalog-items'
import { checkBatch, describeCatalogError, fetchCatalogItems, getCatalogCredentials, isGraphId, sendItemsBatch } from './meta-catalog'

/** Long enough for Meta to process a batch; after this an unanswered one is treated as lost. */
const BATCH_TIMEOUT_MS = 30 * 60 * 1000
const WRITE_CONCURRENCY = 20

interface StoredProduct {
  id: string
  retailer_id: string
  metadata?: Record<string, any> | null
  [column: string]: any
}

export interface PushOutcome {
  state: 'pending' | 'error'
  errors: string[]
  warnings: string[]
  /** The batch Meta took the item in under. */
  handle?: string
  /** The whole request failed (no access, expired connection, rate limit), not this item in particular. */
  requestFailed?: boolean
}

export interface PushSummary {
  /** Taken in by Meta, which now processes them. */
  sent: number
  /** Turned down, by Meta or because a required detail is missing. */
  rejected: number
  outcomes: Map<string, PushOutcome>
  /** Set when Meta refused the request as a whole. */
  requestError?: string
}

function linkedCatalogId(organization: Record<string, any>): string {
  const catalogId = String(organization?.meta_catalog_id || '').trim()
  if (!isGraphId(catalogId)) throw new Error('Link your Meta catalog in Store settings first.')
  return catalogId
}

async function inChunks<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(items.slice(start, start + size).map(run))
  }
}

async function saveCatalogSync(supabase: any, organizationId: string, product: StoredProduct, sync: CatalogSync): Promise<void> {
  const metadata = { ...(product.metadata || {}), catalog: sync }
  product.metadata = metadata
  await supabase.from('commerce_products').update({ metadata }).eq('id', product.id).eq('organization_id', organizationId)
}

/**
 * Send products to the organization's Meta catalog, creating the items that are not there yet.
 * Each product's `metadata.catalog` records how it went. Never throws for a problem with Meta:
 * the summary carries it.
 */
export async function pushProductsToCatalog(
  supabase: any,
  organization: Record<string, any>,
  products: StoredProduct[],
  options: { endSaleIds?: Set<string>; fetcher?: typeof fetch } = {}
): Promise<PushSummary> {
  const catalogId = linkedCatalogId(organization)
  const credentials = getCatalogCredentials(organization)
  const defaults = getCatalogItemDefaults(organization)
  const now = new Date().toISOString()
  const outcomes = new Map<string, PushOutcome>()

  const ready: StoredProduct[] = []
  for (const product of products) {
    const problems = getCatalogProblems(product as any, defaults)
    if (problems.length > 0) outcomes.set(product.id, { state: 'error', errors: problems, warnings: [] })
    else ready.push(product)
  }

  let requestError: string | undefined
  if (ready.length > 0) {
    const batch = await sendItemsBatch(
      credentials,
      catalogId,
      ready.map((product) => toUpsertRequest(product as any, defaults, { endSale: options.endSaleIds?.has(product.id) })),
      options.fetcher
    )
    for (const product of ready) {
      const sku = product.retailer_id
      const failure = batch.failed.get(sku)
      const item = batch.items.get(sku)
      const handle = batch.handleByItem.get(sku)
      if (failure) {
        requestError = requestError || failure
        outcomes.set(product.id, { state: 'error', errors: [failure], warnings: [], requestFailed: true })
      } else if (item && item.errors.length > 0) {
        outcomes.set(product.id, { state: 'error', errors: item.errors, warnings: item.warnings })
      } else if (handle) {
        outcomes.set(product.id, { state: 'pending', errors: [], warnings: item?.warnings || [], handle })
      }
    }
  }

  await inChunks(products, WRITE_CONCURRENCY, async (product) => {
    const outcome = outcomes.get(product.id)
    if (!outcome) return
    // The item in the catalog is untouched by a request Meta refused outright; the next sync shows it as it is
    if (outcome.requestFailed && product.metadata?.source === 'meta') return
    await saveCatalogSync(supabase, organization.id, product, {
      state: outcome.state,
      synced_at: now,
      ...(outcome.handle ? { handle: outcome.handle } : {}),
      ...(outcome.errors.length ? { errors: outcome.errors } : {}),
      ...(outcome.warnings.length ? { warnings: outcome.warnings } : {}),
    })
  })

  const all = [...outcomes.values()]
  return {
    sent: all.filter((outcome) => outcome.state === 'pending').length,
    rejected: all.filter((outcome) => outcome.state === 'error').length,
    outcomes,
    requestError,
  }
}

/** Remove items from the Meta catalog. Returns why it could not, rather than throwing. */
export async function removeFromCatalog(
  organization: Record<string, any>,
  retailerIds: string[],
  fetcher?: typeof fetch
): Promise<{ removed: boolean; error?: string }> {
  try {
    const catalogId = linkedCatalogId(organization)
    const batch = await sendItemsBatch(getCatalogCredentials(organization), catalogId, retailerIds.map(toDeleteRequest), fetcher)
    const failure = [...batch.failed.values()][0] || [...batch.items.values()].find((item) => item.errors.length > 0)?.errors[0]
    return failure ? { removed: false, error: failure } : { removed: true }
  } catch (error) {
    return { removed: false, error: describeCatalogError(error).message }
  }
}

export interface RefreshSummary {
  /** Now confirmed in the catalog. */
  accepted: number
  /** Turned down by Meta while processing. */
  rejected: number
  /** Meta has not finished with these yet. */
  pending: number
}

/** Ask Meta how the batches still being processed went, and record the answer on each product. */
export async function refreshCatalogStatus(
  supabase: any,
  organization: Record<string, any>,
  options: { fetcher?: typeof fetch; limit?: number; now?: number } = {}
): Promise<RefreshSummary> {
  const summary: RefreshSummary = { accepted: 0, rejected: 0, pending: 0 }
  const { data } = await supabase
    .from('commerce_products')
    .select('id, retailer_id, metadata')
    .eq('organization_id', organization.id)
    .eq('metadata->catalog->>state', 'pending')
    .order('id', { ascending: true })
    .limit(options.limit || 500)
  const waiting: StoredProduct[] = data || []
  if (waiting.length === 0) return summary

  const catalogId = linkedCatalogId(organization)
  const credentials = getCatalogCredentials(organization)
  const now = options.now ?? Date.now()
  const stamp = new Date(now).toISOString()

  const byHandle = new Map<string, StoredProduct[]>()
  for (const product of waiting) {
    const handle = getCatalogSync(product)?.handle || ''
    byHandle.set(handle, [...(byHandle.get(handle) || []), product])
  }

  for (const [handle, products] of byHandle) {
    let status: Awaited<ReturnType<typeof checkBatch>> | null = null
    if (handle) {
      try {
        status = await checkBatch(credentials, catalogId, handle, options.fetcher)
      } catch {
        status = null // Meta could not be asked right now; try again on the next refresh
      }
    }

    await inChunks(products, WRITE_CONCURRENCY, async (product) => {
      const previous = getCatalogSync(product)
      if (status?.finished) {
        const warnings = status.warnings.get(product.retailer_id) || previous?.warnings || []
        if (status.invalidIds.has(product.retailer_id)) {
          summary.rejected++
          await saveCatalogSync(supabase, organization.id, product, {
            state: 'error',
            errors: status.errors.get(product.retailer_id) || ['Meta did not accept this item.'],
            synced_at: stamp,
            ...(warnings.length ? { warnings } : {}),
          })
        } else {
          summary.accepted++
          await saveCatalogSync(supabase, organization.id, product, { state: 'synced', synced_at: stamp, ...(warnings.length ? { warnings } : {}) })
        }
        return
      }

      const sentAt = Date.parse(previous?.synced_at || '')
      if (!handle || (Number.isFinite(sentAt) && now - sentAt > BATCH_TIMEOUT_MS)) {
        summary.rejected++
        await saveCatalogSync(supabase, organization.id, product, { state: 'error', errors: ['Meta did not confirm this update. Send it to the catalog again.'], synced_at: stamp })
        return
      }
      summary.pending++
    })
  }

  return summary
}

export interface PullSummary {
  total: number
  synced: number
  removed: number
  /** Kept as they are because a change made here is still being processed, or was turned down by Meta. */
  skipped: number
  error: string | null
}

/**
 * Copy the Meta catalog into `commerce_products`. Items that have left the catalog are removed from
 * the copy; products that were never in it are left alone.
 */
export async function pullCatalogToDatabase(supabase: any, organization: Record<string, any>, fetcher?: typeof fetch): Promise<PullSummary> {
  const catalogId = linkedCatalogId(organization)
  const items = await fetchCatalogItems(getCatalogCredentials(organization), catalogId, fetcher)
  const now = new Date().toISOString()

  // What is stored now: for details Meta's listing does not return, and to find what has left the catalog
  const stored = new Map<string, StoredProduct>()
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await supabase
      .from('commerce_products')
      .select('id, retailer_id, metadata')
      .eq('organization_id', organization.id)
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) return { total: items.length, synced: 0, removed: 0, skipped: 0, error: error.message }
    for (const product of data || []) stored.set(product.retailer_id, product)
    if (!data || data.length < 1000) break
  }

  const inCatalog = new Set<string>()
  const rows: CatalogProductRow[] = []
  let skipped = 0
  for (const item of items) {
    const current = stored.get(String(item?.retailer_id || item?.id || '').trim())
    const row = toCatalogProductRow(item, getProductAttributes(current), now)
    if (!row || inCatalog.has(row.retailer_id)) continue
    inCatalog.add(row.retailer_id)
    // A change made here that Meta has not applied must not be overwritten by the older catalog copy
    const state = current?.metadata?.catalog?.state
    if (state === 'pending' || state === 'error') skipped++
    else rows.push(row)
  }

  let synced = 0
  let firstError: string | null = null
  for (let start = 0; start < rows.length; start += 200) {
    const chunk = rows.slice(start, start + 200)
    const { error } = await supabase
      .from('commerce_products')
      .upsert(chunk.map((row) => ({ organization_id: organization.id, ...row, updated_at: now })), { onConflict: 'organization_id,retailer_id' })
    if (error) firstError = firstError || error.message
    else synced += chunk.length
  }

  // Only after a complete, error-free read, so a partial sync can never empty the product list
  let removed = 0
  if (!firstError && inCatalog.size > 0) {
    const stale = [...stored.values()].filter((product) => product.metadata?.source === 'meta' && !inCatalog.has(product.retailer_id)).map((product) => product.id)
    for (let start = 0; start < stale.length; start += 100) {
      const ids = stale.slice(start, start + 100)
      const { error } = await supabase.from('commerce_products').delete().eq('organization_id', organization.id).in('id', ids)
      if (!error) removed += ids.length
    }
  }

  return { total: inCatalog.size, synced, removed, skipped, error: firstError }
}

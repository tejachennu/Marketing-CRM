/**
 * Front Desk services from the product catalog (the E-commerce connector's products, which sync with
 * the Meta catalog): list them with what is already a service, turn the ticked ones into services
 * (name, price, category, picture), and bring linked services up to date with the catalog's prices.
 */

export interface CatalogProduct { id: string; name: string; price: number; currency: string; category: string; image_url: string | null; description: string; available: boolean; service_id: string | null; billable: boolean | null }

const text = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

export async function listCatalog(db: any, organizationId: string, search = ''): Promise<CatalogProduct[]> {
  let query = db.from('commerce_products').select('id, name, price, currency, category, image_url, description, is_available').eq('organization_id', organizationId).order('category').order('name').limit(500)
  if (search.trim()) query = query.ilike('name', `%${search.trim().replace(/[%_,()]/g, ' ')}%`)
  const [{ data: products, error }, { data: services }] = await Promise.all([
    query,
    db.from('salon_services').select('id, catalog_product_id, billable').eq('organization_id', organizationId).not('catalog_product_id', 'is', null),
  ])
  if (error) {
    // No E-commerce tables yet: no catalog
    if (/commerce_products/.test(error.message || '')) return []
    throw new Error(error.message)
  }
  const linked = new Map((services || []).map((s: any) => [s.catalog_product_id, s]))
  return (products || []).map((p: any) => {
    const s: any = linked.get(p.id)
    return {
      id: p.id,
      name: p.name,
      price: Number(p.price) || 0,
      currency: p.currency || 'INR',
      category: text(p.category, 40) || 'General',
      image_url: p.image_url || null,
      description: text(p.description, 160),
      available: p.is_available !== false,
      service_id: s?.id || null,
      billable: s ? s.billable !== false : null,
    }
  })
}

export interface ImportOptions { product_ids: string[]; billable?: boolean; duration_minutes?: number; tax_rate?: number; category?: string | null }

/** Turn the ticked products into services. Products already linked are left as they are. */
export async function importFromCatalog(db: any, organizationId: string, options: ImportOptions) {
  const ids = [...new Set((options.product_ids || []).filter((id) => /^[0-9a-f-]{36}$/i.test(String(id))))].slice(0, 300)
  if (!ids.length) throw new Error('Tick at least one item from the catalog.')
  const minutes = Math.round(Number(options.duration_minutes ?? 30))
  if (!(minutes >= 5 && minutes <= 600)) throw new Error('A service takes between 5 minutes and 10 hours.')
  const tax = Number(options.tax_rate ?? 18)
  if (!(tax >= 0 && tax <= 28)) throw new Error('GST is between 0% and 28%.')
  const [{ data: products, error }, { data: existing }, { count }] = await Promise.all([
    db.from('commerce_products').select('id, name, price, category, image_url').eq('organization_id', organizationId).in('id', ids),
    db.from('salon_services').select('catalog_product_id').eq('organization_id', organizationId).in('catalog_product_id', ids),
    db.from('salon_services').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
  ])
  if (error) throw new Error(error.message)
  const already = new Set((existing || []).map((s: any) => s.catalog_product_id))
  const fresh = (products || []).filter((p: any) => !already.has(p.id))
  const category = text(options.category, 40)
  const rows = fresh.map((p: any, i: number) => ({
    organization_id: organizationId,
    name: text(p.name, 80) || 'Item',
    category: category || text(p.category, 40) || 'General',
    price: Math.max(0, Math.round((Number(p.price) || 0) * 100) / 100),
    duration_minutes: minutes,
    tax_rate: tax,
    active: true,
    billable: options.billable !== false,
    source: 'catalog',
    catalog_product_id: p.id,
    image_url: p.image_url || null,
    position: (count || 0) + i,
  }))
  let created: any[] = []
  if (rows.length) {
    const { data, error: insertError } = await db.from('salon_services').insert(rows).select('*')
    if (insertError) throw new Error(insertError.message)
    created = data || []
  }
  return { created, skipped: ids.length - created.length }
}

/** Bring services linked to the catalog up to date with the catalog's names, prices and pictures. */
export async function refreshFromCatalog(db: any, organizationId: string) {
  const { data: services, error } = await db.from('salon_services').select('id, name, price, image_url, catalog_product_id').eq('organization_id', organizationId).not('catalog_product_id', 'is', null)
  if (error) throw new Error(error.message)
  if (!services?.length) return { changed: [] as { name: string; from: number; to: number }[] }
  const { data: products } = await db.from('commerce_products').select('id, name, price, image_url').eq('organization_id', organizationId).in('id', services.map((s: any) => s.catalog_product_id))
  const byId = new Map((products || []).map((p: any) => [p.id, p]))
  const changed: { name: string; from: number; to: number }[] = []
  for (const s of services) {
    const p: any = byId.get(s.catalog_product_id)
    if (!p) continue
    const price = Math.round((Number(p.price) || 0) * 100) / 100
    const name = text(p.name, 80) || s.name
    if (price === Number(s.price) && name === s.name && (p.image_url || null) === (s.image_url || null)) continue
    const { error: updateError } = await db.from('salon_services').update({ name, price, image_url: p.image_url || null, updated_at: new Date().toISOString() }).eq('id', s.id).eq('organization_id', organizationId)
    if (updateError) throw new Error(updateError.message)
    changed.push({ name, from: Number(s.price), to: price })
  }
  return { changed }
}

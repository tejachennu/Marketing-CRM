import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { checkImport, MAX_IMPORT_ROWS } from '@/lib/commerce/product-import'
import { withShippingSchema } from '@/lib/commerce/shipping'
import { withInvoiceSchema } from '@/lib/commerce/invoice-store'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST { organizationId, rows: [[headings…], [cells…], …] }: products from a spreadsheet. Checked again here
 * (never trusted from the page). Same SKU = that product is updated; otherwise added. Not sent to the
 * WhatsApp catalog by itself (Products → Send to catalog does that).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'records.write' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!Array.isArray(body.rows) || body.rows.length < 2 || body.rows.length > MAX_IMPORT_ROWS + 1) return NextResponse.json({ error: `Send the sheet with its headings and 1 to ${MAX_IMPORT_ROWS} products.` }, { status: 400 })
  const db = getSupabaseAdminClient()
  const organizationId = String(body.organizationId)
  const { data: org } = await db.from('organizations').select('id, currency').eq('id', organizationId).maybeSingle()
  const check = checkImport(body.rows.map((r: unknown) => (Array.isArray(r) ? r.slice(0, 30) : [])), String(org?.currency || 'INR').toUpperCase())
  if (!check.products.length) return NextResponse.json({ error: check.errors[0] || 'No products found in the sheet.', errors: check.errors }, { status: 400 })

  // Make sure the weight / HSN / GST columns exist, so every row saves in one go
  await withShippingSchema(() => db.from('commerce_products').select('weight_grams, hsn_code').limit(1))
  await withInvoiceSchema(() => db.from('commerce_products').select('gst_rate').limit(1))

  const skus = check.products.map((p) => p.retailer_id)
  const existing = new Map<string, string>()
  for (let i = 0; i < skus.length; i += 200) {
    const { data } = await db.from('commerce_products').select('id, retailer_id').eq('organization_id', organizationId).in('retailer_id', skus.slice(i, i + 200))
    for (const row of data || []) existing.set(row.retailer_id, row.id)
  }
  const now = new Date().toISOString()
  const toRow = ({ madeSku: _made, given: _given, ...p }: (typeof check.products)[number]) => ({ ...p, organization_id: organizationId, updated_at: now })
  const fresh = check.products.filter((p) => !existing.has(p.retailer_id))
  const errors = [...check.errors]
  let added = 0
  let updated = 0
  for (let i = 0; i < fresh.length; i += 100) {
    const { data, error } = await db.from('commerce_products').insert(fresh.slice(i, i + 100).map(toRow)).select('id')
    if (error) errors.push(`Could not add products ${i + 1}–${Math.min(i + 100, fresh.length)}: ${error.message}`)
    else added += (data || []).length
  }
  for (const p of check.products.filter((x) => existing.has(x.retailer_id))) {
    // An update changes only what the sheet filled in (empty cells keep what the product has)
    const all = toRow(p) as any
    const values: Record<string, unknown> = { title: all.title, price: all.price, updated_at: now }
    for (const key of p.given) if (key !== 'retailer_id') values[key] = all[key]
    if (p.given.includes('inventory_count')) values.is_available = all.is_available
    const { error } = await db.from('commerce_products').update(values).eq('id', existing.get(p.retailer_id)).eq('organization_id', organizationId)
    if (error) errors.push(`${p.retailer_id}: ${error.message}`)
    else updated++
  }
  return NextResponse.json({ success: true, added, updated, errors: errors.slice(0, 50) })
}

import { NextRequest, NextResponse } from 'next/server'
import { badRequest, salonAccess, serverError } from '@/lib/salon/server'
import { withSalonSchema } from '@/lib/salon/schema'
import { importFromCatalog, listCatalog, refreshFromCatalog } from '@/lib/salon/catalog'
import { logChange } from '@/lib/salon/change-log'

export const runtime = 'nodejs'

// GET ?organizationId&search: the product catalog, with which items are already services
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await salonAccess(request, params.get('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  try {
    const products = await withSalonSchema(() => listCatalog(access.ctx.db, access.ctx.organizationId, params.get('search') || ''))
    return NextResponse.json({
      success: true,
      products,
      ...(products.length ? {} : { hint: 'No products yet. Add them in E-commerce → Products, or link your Meta catalog in Store settings.' }),
    })
  } catch (error) {
    return serverError('catalog', error)
  }
}

// POST { organizationId, product_ids, billable, duration_minutes, tax_rate, category? }: add the ticked items as services
// POST { organizationId, action: 'refresh' }: update linked services with the catalog's names and prices
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const { db, organizationId } = access.ctx
  try {
    if (body?.action === 'refresh') {
      const { changed } = await withSalonSchema(() => refreshFromCatalog(db, organizationId))
      if (changed.length) await logChange(access.ctx, { area: 'catalog', action: 'prices updated', details: { items: changed.slice(0, 50) } })
      return NextResponse.json({ success: true, changed })
    }
    const result = await withSalonSchema(() => importFromCatalog(db, organizationId, body || {}))
    if (result.created.length) {
      await logChange(access.ctx, {
        area: 'catalog',
        action: 'imported',
        target: `${result.created.length} item${result.created.length === 1 ? '' : 's'}`,
        details: { items: result.created.slice(0, 50).map((s: any) => s.name), billable: body?.billable !== false },
      })
    }
    return NextResponse.json({ success: true, services: result.created, skipped: result.skipped })
  } catch (error: any) {
    if (/Tick at least|takes between|GST is between/.test(error?.message || '')) return badRequest(error.message)
    return serverError('catalog', error)
  }
}

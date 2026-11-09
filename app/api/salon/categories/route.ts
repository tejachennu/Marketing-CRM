import { NextRequest, NextResponse } from 'next/server'
import { badRequest, salonAccess, serverError } from '@/lib/salon/server'
import { withSalonSchema } from '@/lib/salon/schema'
import { categoryName, cleanCategoryList, DEFAULT_CATEGORY, hasCategory, MAX_CATEGORIES, orderedCategories } from '@/lib/salon/categories'

import { logChange } from '@/lib/salon/change-log'

export const runtime = 'nodejs'

/** The business's categories in order (saved list, then any a service uses), and the services. */
async function current(db: any, organizationId: string) {
  const [settings, services] = await Promise.all([
    withSalonSchema(() => db.from('salon_settings').select('*').eq('organization_id', organizationId).maybeSingle()),
    withSalonSchema(() => db.from('salon_services').select('*').eq('organization_id', organizationId).order('position').order('name')),
  ])
  if (settings.error) throw new Error(settings.error.message)
  if (services.error) throw new Error(services.error.message)
  const rows = services.data || []
  return { categories: orderedCategories(settings.data?.service_categories, rows), services: rows }
}

async function saveList(db: any, organizationId: string, list: string[]) {
  const { error } = await withSalonSchema(() => db.from('salon_settings')
    .upsert({ organization_id: organizationId, service_categories: cleanCategoryList(list), updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
    .select('organization_id').single())
  if (error) throw new Error(error.message)
}

// POST { organizationId, name }: a new category at the end of the list (managers and up)
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const name = categoryName(body?.name)
  if (!name) return badRequest('Give the category a name, like "Hair" or "Consultation".')
  const { db, organizationId } = access.ctx
  try {
    const { categories } = await current(db, organizationId)
    if (hasCategory(categories, name)) return badRequest(`There is already a category called "${name}".`)
    if (categories.length >= MAX_CATEGORIES) return badRequest(`You can have up to ${MAX_CATEGORIES} categories.`)
    await saveList(db, organizationId, [...categories, name])
    await logChange(access.ctx, { area: 'category', action: 'added', target: name })
    return NextResponse.json({ success: true, ...(await current(db, organizationId)) }, { status: 201 })
  } catch (error) {
    return serverError('categories', error)
  }
}

// PUT { organizationId, categories: [names] }: the new order (every category, each once)
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const given = cleanCategoryList(body?.categories)
  const { db, organizationId } = access.ctx
  try {
    const { categories } = await current(db, organizationId)
    if (given.length !== categories.length || categories.some((name) => !hasCategory(given, name))) {
      return NextResponse.json({ error: 'The categories changed while you were editing. Reload and try again.' }, { status: 409 })
    }
    // Keep the saved spelling of each name
    await saveList(db, organizationId, given.map((name) => categories.find((c) => c.toLowerCase() === name.toLowerCase())!))
    await logChange(access.ctx, { area: 'category', action: 'reordered', details: { order: given } })
    return NextResponse.json({ success: true, ...(await current(db, organizationId)) })
  } catch (error) {
    return serverError('categories', error)
  }
}

// PATCH { organizationId, from, to }: rename a category; its services move with it
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const from = categoryName(body?.from)
  const to = categoryName(body?.to)
  if (!to) return badRequest('Give the category a name.')
  const { db, organizationId } = access.ctx
  try {
    const { categories, services } = await current(db, organizationId)
    const old = categories.find((c) => c.toLowerCase() === from.toLowerCase())
    if (!old) return NextResponse.json({ error: 'That category is not there any more. Reload and try again.' }, { status: 404 })
    if (to.toLowerCase() !== old.toLowerCase() && hasCategory(categories, to)) return badRequest(`There is already a category called "${to}".`)
    const ids = services.filter((s: any) => (categoryName(s.category) || DEFAULT_CATEGORY).toLowerCase() === old.toLowerCase()).map((s: any) => s.id)
    if (ids.length) {
      const { error } = await db.from('salon_services').update({ category: to, updated_at: new Date().toISOString() }).eq('organization_id', organizationId).in('id', ids)
      if (error) throw new Error(error.message)
    }
    await saveList(db, organizationId, categories.map((c) => (c === old ? to : c)))
    await logChange(access.ctx, { area: 'category', action: 'renamed', target: to, details: { name: { from: old, to }, services: ids.length } })
    return NextResponse.json({ success: true, ...(await current(db, organizationId)) })
  } catch (error) {
    return serverError('categories', error)
  }
}

// DELETE ?organizationId&name&moveTo: remove a category; its services move to another one first
export async function DELETE(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await salonAccess(request, params.get('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  const name = categoryName(params.get('name'))
  const { db, organizationId } = access.ctx
  try {
    const { categories, services } = await current(db, organizationId)
    const old = categories.find((c) => c.toLowerCase() === name.toLowerCase())
    if (!old) return NextResponse.json({ error: 'That category is not there any more. Reload and try again.' }, { status: 404 })
    const ids = services.filter((s: any) => (categoryName(s.category) || DEFAULT_CATEGORY).toLowerCase() === old.toLowerCase()).map((s: any) => s.id)
    let list = categories.filter((c) => c !== old)
    if (ids.length) {
      const asked = categoryName(params.get('moveTo'))
      const target = list.find((c) => c.toLowerCase() === asked.toLowerCase()) || list[0] || (old.toLowerCase() === DEFAULT_CATEGORY.toLowerCase() ? '' : DEFAULT_CATEGORY)
      if (!target) return badRequest('Its services need another category to go to. Add one first.')
      if (!hasCategory(list, target)) list = [...list, target]
      const { error } = await db.from('salon_services').update({ category: target, updated_at: new Date().toISOString() }).eq('organization_id', organizationId).in('id', ids)
      if (error) throw new Error(error.message)
    }
    await saveList(db, organizationId, list)
    await logChange(access.ctx, { area: 'category', action: 'removed', target: old, details: { services_moved: ids.length } })
    return NextResponse.json({ success: true, ...(await current(db, organizationId)) })
  } catch (error) {
    return serverError('categories', error)
  }
}

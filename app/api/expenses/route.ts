import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { cleanExpense, readMonth } from '@/lib/expenses/rules'
import { addExpense, copyRepeats, deleteExpense, loadExpensesOverview, ownCategoryList, updateExpense } from '@/lib/expenses/store'

export const runtime = 'nodejs'

/**
 * Expenses (salaries, rent, stock…) and the money picture. Admins only: salaries are private.
 * GET ?organizationId&month=YYYY-MM → the month's expenses, where the money went, the last 6 months' sales vs
 * expenses, the month's AI review if there is one.
 * POST { organizationId, ...expense } adds one; POST { organizationId, action: 'copy_repeats', month } copies the
 * monthly ones (salaries, rent) into that month. PUT { organizationId, id, ...expense }. DELETE ?organizationId&id.
 */
export async function GET(request: NextRequest) {
  const organizationId = request.nextUrl.searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const month = readMonth(request.nextUrl.searchParams.get('month'))
    return NextResponse.json(await loadExpensesOverview(getSupabaseAdminClient(), organizationId!, month))
  } catch (error: any) {
    console.error('[Expenses]', error?.message)
    return NextResponse.json({ error: 'Expenses could not be loaded. Please try again.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  try {
    if (body.action === 'copy_repeats') {
      const added = await copyRepeats(db, body.organizationId, readMonth(body.month), access.user?.id || null)
      return NextResponse.json({ success: true, added })
    }
    // A typed category the business used before keeps that spelling ("tea" → "Tea")
    const checked = cleanExpense(body, Date.now(), await ownCategoryList(db, body.organizationId))
    if ('error' in checked) return NextResponse.json({ error: checked.error, field: checked.field }, { status: 400 })
    const expense = await addExpense(db, body.organizationId, checked.value, access.user?.id || null)
    return NextResponse.json({ success: true, expense })
  } catch (error: any) {
    console.error('[Expenses]', error?.message)
    return NextResponse.json({ error: 'It could not be saved. Please try again.' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (typeof body.id !== 'string' || !body.id) return NextResponse.json({ error: 'Which expense?' }, { status: 400 })
  const db = getSupabaseAdminClient()
  const checked = cleanExpense(body, Date.now(), await ownCategoryList(db, body.organizationId))
  if ('error' in checked) return NextResponse.json({ error: checked.error, field: checked.field }, { status: 400 })
  try {
    const expense = await updateExpense(db, body.organizationId, body.id, checked.value)
    if (!expense) return NextResponse.json({ error: 'This expense was removed.' }, { status: 404 })
    return NextResponse.json({ success: true, expense })
  } catch (error: any) {
    console.error('[Expenses]', error?.message)
    return NextResponse.json({ error: 'It could not be saved. Please try again.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const organizationId = request.nextUrl.searchParams.get('organizationId')
  const id = request.nextUrl.searchParams.get('id')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!id) return NextResponse.json({ error: 'Which expense?' }, { status: 400 })
  try {
    const removed = await deleteExpense(getSupabaseAdminClient(), organizationId!, id)
    return NextResponse.json({ success: true, removed })
  } catch (error: any) {
    console.error('[Expenses]', error?.message)
    return NextResponse.json({ error: 'It could not be removed. Please try again.' }, { status: 500 })
  }
}

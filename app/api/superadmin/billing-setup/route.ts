import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'
import { migrationConnectionString, runBillingMigration } from '@/lib/billing-migration'

export const runtime = 'nodejs'
export const maxDuration = 60

async function billingReady(db: any): Promise<boolean> {
  const { error } = await db.from('organization_billing').select('organization_id', { head: true, count: 'exact' }).limit(1)
  return !error
}

// GET: is billing switched on, and can the console switch it on (a database connection is set)?
export async function GET(request: NextRequest) {
  if (!(await checkSuperAdmin(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ ready: await billingReady(getSupabaseAdminClient()), canSwitchOn: Boolean(migrationConnectionString()) })
}

// POST: switch billing on by running the billing migration (super admins only; safe to repeat)
export async function POST(request: NextRequest) {
  const actor = await checkSuperAdmin(request)
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const connectionString = migrationConnectionString()
  if (!connectionString) {
    return NextResponse.json({ error: 'No database connection is set on the server (POSTGRES_URL). Run the billing SQL in the Supabase SQL editor instead.' }, { status: 400 })
  }
  try {
    await runBillingMigration(connectionString)
  } catch (error: any) {
    console.error('[Billing setup] Migration failed:', error?.message)
    return NextResponse.json({ error: `Billing could not be switched on: ${error?.message || 'database error'}. Nothing was changed.` }, { status: 500 })
  }
  const db = getSupabaseAdminClient()
  const { data: rows } = await db.from('organization_billing').select('organization_id, billing_exempt')
  const exemptIds = (rows || []).filter((row: any) => row.billing_exempt).map((row: any) => row.organization_id)
  const { data: exempt } = exemptIds.length ? await db.from('organizations').select('name').in('id', exemptIds) : { data: [] as any[] }
  console.log(`[Billing setup] Switched on by ${actor.email || actor.id}: ${(rows || []).length} workspaces, ${exemptIds.length} exempt`)
  return NextResponse.json({
    success: true,
    ready: await billingReady(db),
    workspaces: (rows || []).length,
    exempt: (exempt || []).map((org: any) => org.name),
  })
}

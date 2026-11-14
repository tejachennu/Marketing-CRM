import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'
import { migrationConnectionString, runBillingMigration } from '@/lib/billing-migration'
import { firebaseAppConfig, serviceAccount } from '@/lib/push'
import { razorpayMode, resetBillingData, workspacesWithLiveSubscriptions } from '@/lib/billing-reset'

export const runtime = 'nodejs'
export const maxDuration = 60

async function billingReady(db: any): Promise<boolean> {
  const { error } = await db.from('organization_billing').select('organization_id', { head: true, count: 'exact' }).limit(1)
  return !error
}

// GET: is billing switched on, and can the console switch it on (a database connection is set)?
export async function GET(request: NextRequest) {
  if (!(await checkSuperAdmin(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({
    ready: await billingReady(getSupabaseAdminClient()),
    canSwitchOn: Boolean(migrationConnectionString()),
    // Which Razorpay keys the server has (never the keys themselves)
    razorpay: { mode: razorpayMode(), webhook: Boolean(String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim()) },
    // Pop-up notifications: the app's settings and the server's sending key (yes or no, never the values)
    push: { app: Boolean(firebaseAppConfig()), server: Boolean(serviceAccount()) },
  })
}

// POST {}: switch billing on by running the billing migration (super admins only; safe to repeat)
// POST { action: 'reset' }: clear billing test data (see lib/billing-reset.ts)
export async function POST(request: NextRequest) {
  const actor = await checkSuperAdmin(request)
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const connectionString = migrationConnectionString()
  if (body?.action === 'reset') {
    if (!connectionString) return NextResponse.json({ error: 'No database connection is set on the server (POSTGRES_URL).' }, { status: 400 })
    const db = getSupabaseAdminClient()
    if (!(await billingReady(db))) return NextResponse.json({ error: 'Billing is not switched on yet, so there is nothing to clear.' }, { status: 400 })
    try {
      const { data: rows } = await db.from('organization_billing').select('organization_id, razorpay_subscription_id')
      const keep = await workspacesWithLiveSubscriptions(rows || [])
      const reset = await resetBillingData(connectionString, keep)
      console.log(`[Billing reset] By ${actor.email || actor.id}: ${reset} workspaces reset, ${keep.length} with live subscriptions kept`)
      return NextResponse.json({ success: true, reset, kept: keep.length })
    } catch (error: any) {
      console.error('[Billing reset] Failed:', error?.message)
      return NextResponse.json({ error: `Billing data could not be cleared: ${error?.message || 'database error'}. Nothing was changed.` }, { status: 500 })
    }
  }
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

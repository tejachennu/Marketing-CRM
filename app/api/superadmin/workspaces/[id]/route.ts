import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'
import { getBilling } from '@/lib/billing'
import { isUuid } from '@/lib/record-visibility'
import { applyWorkspaceAction, parseWorkspaceAction, summarizeWorkspace } from '@/lib/superadmin-workspaces'

const ORG_COLUMNS = 'id, name, slug, created_at, contact_name, contact_email, contact_phone, whatsapp_provider, whatsapp_phone_number_id, whatsapp_default_phone, twilio_account_sid, max_teammates, enable_ai, enable_email, enable_messages, enable_phone_calls, enable_sms, enable_commerce'

async function details(db: any, id: string) {
  const { data: organization, error } = await db.from('organizations').select(ORG_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw error
  if (!organization) return null
  const billing = await getBilling(db, id)
  const { data: members } = await db.from('users').select('id, email, full_name, role, created_at').eq('organization_id', id).order('created_at', { ascending: true })

  // AI credit activity: the latest entries, and this month's usage
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const [recent, month] = await Promise.all([
    db.from('ai_wallet_transactions').select('kind, amount, feature, model, tokens, created_at').eq('organization_id', id).order('created_at', { ascending: false }).limit(15),
    db.from('ai_wallet_transactions').select('amount, feature').eq('organization_id', id).eq('kind', 'usage').gte('created_at', monthStart.toISOString()).limit(5000),
  ])
  const usageByFeature: Record<string, number> = {}
  for (const row of month.data || []) {
    const feature = row.feature || 'other'
    usageByFeature[feature] = Math.round(((usageByFeature[feature] || 0) + Math.abs(Number(row.amount) || 0)) * 100) / 100
  }
  const { data: payments } = await db.from('billing_payments').select('purpose, amount_paise, razorpay_payment_id, created_at').eq('organization_id', id).order('created_at', { ascending: false }).limit(10)

  return {
    workspace: summarizeWorkspace(organization, billing, (members || []).length),
    organization,
    billingRow: billing ? { trial_ends_at: billing.trial_ends_at, current_period_end: billing.current_period_end, razorpay_subscription_id: billing.razorpay_subscription_id, ai_allowance: Number(billing.ai_allowance) } : null,
    members: members || [],
    aiActivity: recent.error ? [] : recent.data || [],
    aiUsageThisMonth: usageByFeature,
    payments: payments || [],
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await checkSuperAdmin(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid workspace id' }, { status: 400 })
  try {
    const result = await details(getSupabaseAdminClient(), id)
    if (!result) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    console.error('[SuperAdmin workspace]', error?.message)
    return NextResponse.json({ error: error?.message || 'The workspace could not be loaded' }, { status: 500 })
  }
}

/** POST { action, ... }: see parseWorkspaceAction. Returns the workspace as it is afterwards. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await checkSuperAdmin(request)
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid workspace id' }, { status: 400 })
  const parsed = parseWorkspaceAction(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    const db = getSupabaseAdminClient()
    const { data: exists } = await db.from('organizations').select('id').eq('id', id).maybeSingle()
    if (!exists) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    await applyWorkspaceAction(db, id, parsed.action, actor.id || null)
    return NextResponse.json({ success: true, ...(await details(db, id)) })
  } catch (error: any) {
    console.error('[SuperAdmin workspace action]', parsed.action.action, error?.message)
    return NextResponse.json({ error: error?.message || 'The change could not be saved' }, { status: 500 })
  }
}

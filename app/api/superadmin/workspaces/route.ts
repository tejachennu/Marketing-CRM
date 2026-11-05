import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'
import { summarizeWorkspace, workspaceTotals } from '@/lib/superadmin-workspaces'

/** Every workspace with its plan, AI credit and team size, plus totals for the overview. */
export async function GET(request: NextRequest) {
  if (!(await checkSuperAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const db = getSupabaseAdminClient()
    const { data: organizations, error } = await db
      .from('organizations')
      .select('id, name, slug, created_at, contact_email, whatsapp_provider, whatsapp_phone_number_id, twilio_account_sid, max_teammates, enable_ai')
      .order('created_at', { ascending: false })
    if (error) throw error

    // Before the billing migration has run the table is missing: every workspace shows as before
    const billingRows = await db.from('organization_billing').select('*')
    const billingByOrg = new Map<string, any>((billingRows.error ? [] : billingRows.data || []).map((row: any) => [row.organization_id, row]))

    const workspaces = await Promise.all((organizations || []).map(async (organization: any) => {
      const { count } = await db.from('users').select('id', { count: 'exact', head: true }).eq('organization_id', organization.id)
      return summarizeWorkspace(organization, billingByOrg.get(organization.id) || null, count || 0)
    }))

    return NextResponse.json({ success: true, billingReady: !billingRows.error, workspaces, totals: workspaceTotals(workspaces) })
  } catch (error: any) {
    console.error('[SuperAdmin workspaces]', error?.message)
    return NextResponse.json({ error: error?.message || 'Workspaces could not be loaded' }, { status: 500 })
  }
}

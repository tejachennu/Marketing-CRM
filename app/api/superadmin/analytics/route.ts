import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'

export async function GET(request: NextRequest) {
  const isSuperAdmin = await checkSuperAdmin(request)
  if (!isSuperAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getSupabaseAdminClient()

    // Fetch overall counts
    const { count: orgCount } = await supabase.from('organizations').select('*', { count: 'exact', head: true })
    const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true })
    const { count: contactCount } = await supabase.from('contacts').select('*', { count: 'exact', head: true })
    const { count: messageCount } = await supabase.from('messages').select('*', { count: 'exact', head: true })
    const { count: campaignCount } = await supabase.from('campaigns').select('*', { count: 'exact', head: true })

    // Fetch organizations
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, name, slug, created_at')
      .order('created_at', { ascending: false })

    // Count each organization's rows with exact count queries. Downloading the rows to count them
    // stops at the 1,000-row request limit and under-reports every organization past it.
    const countFor = async (table: string, organizationId: string) => {
      const { count } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
      return count || 0
    }

    const mappedOrgs = await Promise.all((orgs || []).map(async (org) => {
      const [users, contacts, campaigns, messages] = await Promise.all([
        countFor('users', org.id),
        countFor('contacts', org.id),
        countFor('campaigns', org.id),
        countFor('messages', org.id),
      ])

      // AI usage is not metered yet. This is an estimate from activity, shown as such in the console.
      const aiTokens = messages * 250 + campaigns * 1000 // roughly 250 tokens per message
      const aiCost = aiTokens * 0.000002 // gpt-4o-mini approx cost

      return {
        ...org,
        usersCount: users,
        contactsCount: contacts,
        campaignsCount: campaigns,
        messagesCount: messages,
        aiTokens,
        aiCost
      }
    }))

    return NextResponse.json({
      success: true,
      stats: {
        organizations: orgCount || 0,
        users: userCount || 0,
        contacts: contactCount || 0,
        messages: messageCount || 0,
        campaigns: campaignCount || 0,
        totalAiTokens: mappedOrgs.reduce((acc, org) => acc + org.aiTokens, 0),
        totalAiCost: mappedOrgs.reduce((acc, org) => acc + org.aiCost, 0),
        aiUsageEstimated: true,
      },
      organizationsList: mappedOrgs
    })
  } catch (error: any) {
    console.error('[SuperAdmin Analytics API] Error:', error)
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}

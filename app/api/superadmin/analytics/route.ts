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

    // Fetch items for counts mapping
    const { data: userMapping } = await supabase.from('users').select('organization_id')
    const { data: contactMapping } = await supabase.from('contacts').select('organization_id')
    const { data: campaignMapping } = await supabase.from('campaigns').select('organization_id')
    const { data: messageMapping } = await supabase.from('messages').select('organization_id')

    const mappedOrgs = (orgs || []).map((org) => {
      const users = (userMapping || []).filter(u => u.organization_id === org.id).length
      const contacts = (contactMapping || []).filter(c => c.organization_id === org.id).length
      const campaigns = (campaignMapping || []).filter(c => c.organization_id === org.id).length
      const messages = (messageMapping || []).filter(m => m.organization_id === org.id).length

      // Mock AI Usage for the admin panel demonstration
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
    })

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
      },
      organizationsList: mappedOrgs
    })
  } catch (error: any) {
    console.error('[SuperAdmin Analytics API] Error:', error)
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}

import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/api-auth-helper'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

interface InsightCard {
  id: string
  type: 'warning' | 'success' | 'info' | 'urgent'
  icon: string
  title: string
  description: string
  metric?: number
  action?: string
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const orgId = user.organization_id
    if (!orgId) {
      return NextResponse.json({ error: 'Forbidden: No organization assigned' }, { status: 403 })
    }

    const supabase = getSupabaseClient()
    const cards: InsightCard[] = []

    // 1. Fetch stale active conversations (no operator reply > 4 hours, unread)
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
    const { data: staleConvs, error: staleConvsErr } = await supabase
      .from('conversations')
      .select('id, last_message_at, contact:contacts(first_name, last_name)')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .lt('last_message_at', fourHoursAgo)
      .gt('unread_count', 0)
      .limit(5)

    if (!staleConvsErr && staleConvs && staleConvs.length > 0) {
      const names = staleConvs.map((c: any) => c.contact ? `${c.contact.first_name || 'Contact'}` : 'Unknown').join(', ')
      cards.push({
        id: 'stale_chats',
        type: 'urgent',
        icon: '⏰',
        title: `${staleConvs.length} unanswered chats`,
        description: `Chats from ${names} have been waiting for over 4 hours.`,
        metric: staleConvs.length,
        action: 'Show unread conversations'
      })
    }

    // 2. Fetch hot active leads (value >= 10k or priority=high with recent activity)
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const { data: hotLeads, error: hotLeadsErr } = await supabase
      .from('leads')
      .select('id, title, value, priority')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .or('priority.eq.high,value.gte.10000')
      .gte('last_activity_at', twoDaysAgo)
      .limit(5)

    if (!hotLeadsErr && hotLeads && hotLeads.length > 0) {
      const totalVal = hotLeads.reduce((s: number, l: any) => s + (l.value || 0), 0)
      cards.push({
        id: 'hot_leads',
        type: 'info',
        icon: '🔥',
        title: `${hotLeads.length} hot leads active`,
        description: `Total pipeline value of active hot deals: ${totalVal.toLocaleString()}`,
        metric: hotLeads.length,
        action: 'Pipeline summary'
      })
    }

    // 3. Fetch at-risk leads (no activity in 5+ days)
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    const { data: staleLeads, error: staleLeadsErr } = await supabase
      .from('leads')
      .select('id, title, value')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .lt('last_activity_at', fiveDaysAgo)
      .limit(5)

    if (!staleLeadsErr && staleLeads && staleLeads.length > 0) {
      cards.push({
        id: 'stale_leads',
        type: 'warning',
        icon: '💀',
        title: `${staleLeads.length} leads going cold`,
        description: `No operator activity recorded for these active deals in the last 5 days.`,
        metric: staleLeads.length,
        action: 'Leads going cold'
      })
    }

    // 4. Fetch overdue support tickets (active tickets older than 3 days)
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const { count: overdueCount, error: overdueErr } = await supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .lt('created_at', threeDaysAgo)

    if (!overdueErr && overdueCount && overdueCount > 0) {
      cards.push({
        id: 'overdue_tickets',
        type: 'urgent',
        icon: '🎫',
        title: `${overdueCount} overdue support tickets`,
        description: `Tickets have been open for more than 3 days without resolution.`,
        metric: overdueCount,
        action: 'Show overdue tickets'
      })
    }

    // 5. Today's summary card
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString()

    const [msgCount, leadsWon, resolvedTickets, newLeads] = await Promise.all([
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('sender_type', 'user').gte('created_at', todayISO),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'won').gte('won_at', todayISO),
      supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'closed').gte('closed_at', todayISO),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).gte('created_at', todayISO)
    ])

    cards.push({
      id: 'today_summary',
      type: 'success',
      icon: '📊',
      title: 'Today\'s CRM stats',
      description: `${msgCount.count || 0} chats sent, ${newLeads.count || 0} new leads created, ${leadsWon.count || 0} won, ${resolvedTickets.count || 0} support resolved.`
    })

    return NextResponse.json({ insights: cards })

  } catch (err: any) {
    console.error('[Insights API] Critical error:', err)
    return NextResponse.json({ insights: [] })
  }
}

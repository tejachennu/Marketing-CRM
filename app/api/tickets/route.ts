import { NextRequest, NextResponse } from 'next/server'
import { sendPush } from '@/lib/push'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess, verifyRecordAccess } from '@/lib/api-auth-helper'
import { can, canSeeAll, describeDenied } from '@/lib/rbac'
import { isUuid } from '@/lib/record-visibility'

const TICKET_STATUSES = ['open', 'resolved']

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()
    // The Tickets screen (the app): either list, search, dates, a page, the counts, and the team and stages
    if (searchParams.get('view') === 'list') return listTickets(supabase, orgId, authResult.user, searchParams)

    let query = supabase
      .from('tickets')
      .select(`
        id,
        subject,
        status,
        created_at,
        conversation_id,
        contact_id,
        assigned_to,
        contacts (
          first_name,
          last_name,
          phone_number
        )
      `)
      .eq('organization_id', orgId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })

    // Someone who only sees their own work gets the tickets assigned to them
    if (!canSeeAll(authResult.user)) {
      query = query.eq('assigned_to', authResult.user.id)
    }

    const { data: tickets, error } = await query

    if (error) {
      throw error
    }

    return NextResponse.json({ success: true, tickets })
  } catch (error: any) {
    console.error('[API] Get tickets error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to retrieve tickets' },
      { status: 500 }
    )
  }
}

const PAGE = 20
const clean = (value: string | null) => String(value || '').replace(/[%,()*\\]/g, ' ').trim().slice(0, 60)

async function listTickets(supabase: any, orgId: string, user: any, params: URLSearchParams) {
  const status = params.get('status') === 'resolved' ? 'resolved' : 'open'
  const offset = Math.max(0, Number(params.get('offset')) || 0)
  const own = !canSeeAll(user)
  const mine = (query: any) => (own ? query.eq('assigned_to', user.id) : query)
  const count = (state?: string) => {
    let query = mine(supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('organization_id', orgId))
    if (state) query = query.eq('status', state)
    return query
  }

  let query = mine(supabase.from('tickets')
    .select('id, subject, status, created_at, updated_at, conversation_id, contact_id, assigned_to, contacts ( first_name, last_name, phone_number, email )', { count: 'exact' })
    .eq('organization_id', orgId).eq('status', status))
  const search = clean(params.get('q'))
  if (search) {
    const { data: people } = await supabase.from('contacts').select('id').eq('organization_id', orgId)
      .or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone_number.ilike.%${search}%`).limit(200)
    const ids = (people || []).map((c: any) => c.id)
    query = ids.length ? query.or(`subject.ilike.%${search}%,contact_id.in.(${ids.join(',')})`) : query.ilike('subject', `%${search}%`)
  }
  const from = params.get('from')
  const to = params.get('to')
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte('created_at', new Date(`${from}T00:00:00+05:30`).toISOString())
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte('created_at', new Date(`${to}T23:59:59.999+05:30`).toISOString())

  const [list, total, open, resolved] = await Promise.all([
    query.order('created_at', { ascending: false }).range(offset, offset + PAGE - 1),
    count(), count('open'), count('resolved'),
  ])
  if (list.error) throw list.error
  const tickets = (list.data || []).map((t: any) => ({ ...t, contacts: Array.isArray(t.contacts) ? t.contacts[0] : t.contacts }))
  const result: Record<string, any> = {
    success: true,
    tickets,
    more: Math.max(0, (list.count || 0) - offset - tickets.length),
    counts: { total: total.count || 0, open: open.count || 0, resolved: resolved.count || 0 },
  }
  if (params.get('meta') === '1') {
    const [team, stages] = await Promise.all([
      supabase.from('users').select('id, full_name, email').eq('organization_id', orgId),
      supabase.from('pipeline_stages').select('id, name, position').eq('organization_id', orgId).order('position'),
    ])
    result.team = (team.data || []).map((u: any) => ({ id: u.id, name: u.full_name || u.email }))
    result.stages = stages.data || []
    result.can = { assign: can(user, 'records.assign'), write: can(user, 'records.write') }
  }
  return NextResponse.json(result)
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const ticketId = body?.ticketId
    const status = body?.status
    const changesAssignee = body !== null && 'assignedTo' in body
    const assignedTo = changesAssignee ? (body.assignedTo || null) : undefined

    if (!ticketId || (status === undefined && !changesAssignee)) {
      return NextResponse.json({ error: 'Missing ticketId or status' }, { status: 400 })
    }
    if (status !== undefined && !TICKET_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Status must be one of: ${TICKET_STATUSES.join(', ')}` }, { status: 400 })
    }
    if (assignedTo && !isUuid(assignedTo)) {
      return NextResponse.json({ error: 'Invalid assignedTo' }, { status: 400 })
    }

    // Read-only accounts cannot change tickets; assigned-only accounts can change their own
    const recordResult = await verifyRecordAccess(request, 'tickets', ticketId, {
      permission: 'records.write',
      assignedColumn: 'assigned_to',
    })
    if (!recordResult.authorized) {
      return NextResponse.json({ error: recordResult.error }, { status: recordResult.status })
    }
    // Handing work to someone is for admins and managers
    if (changesAssignee && !can(recordResult.user, 'records.assign')) {
      return NextResponse.json({ error: describeDenied('records.assign') }, { status: 403 })
    }

    const supabase = getSupabaseClient()

    if (assignedTo) {
      // The assignee has to be a member of the ticket's organization
      const { data: ticket } = await supabase.from('tickets').select('organization_id').eq('id', ticketId).maybeSingle()
      const { data: assignee } = await supabase
        .from('users')
        .select('id')
        .eq('id', assignedTo)
        .eq('organization_id', ticket?.organization_id || '')
        .maybeSingle()
      if (!assignee) {
        return NextResponse.json({ error: 'That teammate is not in this organization' }, { status: 400 })
      }
    }

    const update: Record<string, any> = { updated_at: new Date().toISOString() }
    if (status !== undefined) update.status = status
    if (changesAssignee) update.assigned_to = assignedTo

    const { data, error } = await supabase
      .from('tickets')
      .update(update)
      .eq('id', ticketId)
      .select()
      .single()

    if (error) {
      throw error
    }

    // Tell the person it was given to (not when they took it themselves)
    if (changesAssignee && assignedTo && data?.organization_id) {
      await sendPush(supabase, { organizationId: data.organization_id, userIds: [assignedTo], exceptUserId: recordResult.user?.id }, { kind: 'ticket', title: 'Ticket assigned to you', body: data.subject || 'Open it to see the details', open: 'tickets', tag: `ticket:${data.id}` })
    }

    return NextResponse.json({ success: true, ticket: data })
  } catch (error: any) {
    console.error('[API] Update ticket error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update ticket' },
      { status: 500 }
    )
  }
}

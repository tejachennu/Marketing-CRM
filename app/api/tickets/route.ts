import { NextRequest, NextResponse } from 'next/server'
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

    return NextResponse.json({ success: true, ticket: data })
  } catch (error: any) {
    console.error('[API] Update ticket error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update ticket' },
      { status: 500 }
    )
  }
}

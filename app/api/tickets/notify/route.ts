import { NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { emailTicketAlert } from '@/lib/ticket-alerts'

/**
 * POST { organizationId, ticketSubject, contactName, contactPhone, ticketId }: email the ticket alert.
 * Called server to server; it only emails about a ticket that really exists in that workspace.
 */
export async function POST(request: Request) {
  try {
    const { organizationId, ticketSubject, contactName, contactPhone, ticketId } = await request.json()
    if (!organizationId || !ticketId) return NextResponse.json({ sent: false, reason: 'missing_fields' }, { status: 400 })
    const db = getSupabaseAdminClient()
    const { data: ticket } = await db.from('tickets').select('id').eq('id', ticketId).eq('organization_id', organizationId).maybeSingle()
    if (!ticket) return NextResponse.json({ sent: false, reason: 'ticket_not_found' }, { status: 404 })
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin
    return NextResponse.json(await emailTicketAlert(db, { organizationId, ticketId, ticketSubject, contactName, contactPhone }, appUrl))
  } catch (error) {
    console.error('Ticket notification error:', error)
    return NextResponse.json({ sent: false, reason: 'internal_error' }, { status: 500 })
  }
}

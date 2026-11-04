import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyRecordAccess } from '@/lib/api-auth-helper'
import { can, canSeeAll, describeDenied, isReadOnly } from '@/lib/rbac'
import { assignConversation, canAccessConversation, findOtherHandler, isUuid, loadConversationRef } from '@/lib/record-visibility'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

/**
 * POST /api/conversations/[id]/assign — give a chat to someone.
 *
 * Without a body the caller takes the chat themselves ("Assign to me"): anyone who may write and
 * may see the chat, as long as nobody has it and no teammate is handling the customer through a
 * lead or ticket. `{ assignedTo: <user id> }` hands it to a teammate and `{ assignedTo: null }`
 * leaves it with nobody; both need records.assign (admins and managers), who may also take a chat
 * a teammate holds. Either way the chat leaves the hand-off queue.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 })
    }

    const authResult = await verifyRecordAccess(request, 'conversations', id, { permission: 'records.write' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }
    const user = authResult.user

    const body = await request.json().catch(() => ({}))
    const requested = body?.assignedTo
    // Who gets the chat: the caller, unless the body names a teammate (or null, for nobody)
    const target: string | null = requested === undefined ? user.id : requested
    if (target !== null && !isUuid(target)) {
      return NextResponse.json({ error: 'Invalid assignedTo' }, { status: 400 })
    }
    const takingIt = target === user.id

    if (!takingIt && !can(user, 'records.assign')) {
      return NextResponse.json({ error: describeDenied('records.assign') }, { status: 403 })
    }

    const supabase = getSupabaseClient()
    const conversation = await loadConversationRef(supabase, id)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    if (takingIt && !canSeeAll(user) && !(await canAccessConversation(supabase, user, conversation))) {
      return NextResponse.json({ error: describeDenied('records.view_all') }, { status: 403 })
    }

    if (conversation.assigned_to === target) {
      return NextResponse.json({ success: true, changed: false, conversation: { id, assigned_to: target } })
    }
    // Taking a chat a teammate holds is reassigning it, which only managers do
    if (conversation.assigned_to && !can(user, 'records.assign')) {
      return NextResponse.json({ error: 'A teammate already has this chat.', code: 'already_assigned' }, { status: 409 })
    }

    if (target && !takingIt) {
      const { data: teammate } = await supabase
        .from('users')
        .select('id, role, read_only')
        .eq('id', target)
        .eq('organization_id', conversation.organization_id)
        .maybeSingle()
      if (!teammate) {
        return NextResponse.json({ error: 'Teammate not found' }, { status: 404 })
      }
      if (isReadOnly(teammate)) {
        return NextResponse.json({ error: 'This teammate is read-only and cannot work chats.' }, { status: 400 })
      }
    }

    // Someone limited to their own work does not take a customer a teammate is handling (the rule replies follow too)
    if (takingIt && !canSeeAll(user) && conversation.contact_id) {
      const handler = await findOtherHandler(supabase, conversation.organization_id, user.id, conversation.contact_id, id)
      if (handler) {
        return NextResponse.json({ error: `This customer is being handled by ${handler}`, code: 'handled_by_teammate' }, { status: 403 })
      }
    }

    // A chat seen as free is taken only while it still is, so two agents clicking at once cannot both win
    const changed = await assignConversation(supabase, {
      conversationId: id,
      organizationId: conversation.organization_id,
      userId: target,
      onlyUnassigned: conversation.assigned_to == null,
    })
    if (!changed) {
      return NextResponse.json({ error: 'A teammate just took this chat.', code: 'already_assigned' }, { status: 409 })
    }

    return NextResponse.json({ success: true, changed: true, conversation: { id, assigned_to: target, handed_off_at: null } })
  } catch (error: any) {
    console.error('[API] Assign conversation error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to assign the conversation' }, { status: 500 })
  }
}

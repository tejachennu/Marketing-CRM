import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyRecordAccess } from '@/lib/api-auth-helper'
import { canSeeAll, describeDenied } from '@/lib/rbac'
import { canAccessConversation, isHandOffColumnMissing, isUuid, loadConversationRef, warnMissingHandOffColumn } from '@/lib/record-visibility'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

/**
 * PATCH /api/conversations/[id] — switch the chatbot on or off for one chat
 * (`{ auto_reply_enabled: boolean }`). Switching it back on ends a hand-off: the customer is the
 * chatbot's again, not the team's. Switching it off by hand is not a hand-off.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 })
    }

    const body = await request.json().catch(() => null)
    const enabled = body?.auto_reply_enabled
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'auto_reply_enabled must be true or false' }, { status: 400 })
    }

    const authResult = await verifyRecordAccess(request, 'conversations', id, { permission: 'records.write' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }
    const user = authResult.user

    const supabase = getSupabaseClient()
    const conversation = await loadConversationRef(supabase, id)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    if (!canSeeAll(user) && !(await canAccessConversation(supabase, user, conversation))) {
      return NextResponse.json({ error: describeDenied('records.view_all') }, { status: 403 })
    }

    const update = (values: Record<string, unknown>) =>
      supabase.from('conversations').update(values).eq('id', id).eq('organization_id', conversation.organization_id)
    let { error } = await update(enabled ? { auto_reply_enabled: true, handed_off_at: null } : { auto_reply_enabled: false })
    if (isHandOffColumnMissing(error)) {
      warnMissingHandOffColumn()
      ;({ error } = await update({ auto_reply_enabled: enabled }))
    }
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true, conversation: { id, auto_reply_enabled: enabled, ...(enabled ? { handed_off_at: null } : {}) } })
  } catch (error: any) {
    console.error('[API] Update conversation error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update the conversation' }, { status: 500 })
  }
}

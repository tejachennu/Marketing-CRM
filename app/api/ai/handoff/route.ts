import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { readHandoffSettings } from '@/lib/ai/knowledge-rules'
import { loadHandoffSettings, loadReplyStyle, saveHandoffSettings, withKnowledgeSchema } from '@/lib/ai/knowledge-store'
import { readReplyStyle } from '@/lib/ai/reply-format'

export const runtime = 'nodejs'

// GET ?organizationId=: how the AI hands a chat to the team (Settings → Chat and tickets)
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = getSupabaseAdminClient()
  // Sets the columns up the first time, so the first save works
  await withKnowledgeSchema(() => db.from('organizations').select('ai_handoff').eq('id', organizationId).maybeSingle())
  return NextResponse.json({ settings: await loadHandoffSettings(db, organizationId!), style: await loadReplyStyle(db, organizationId!) })
}

// PUT { organizationId, settings: { pauseAi, resumeOnResolve, keepAiWhenUnsure, message }, style?: { tone, emoji, buttons, typing } } (managers)
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const settings = readHandoffSettings(body?.settings)
  const style = body?.style ? readReplyStyle(body.style) : undefined
  try {
    await saveHandoffSettings(getSupabaseAdminClient(), body.organizationId, settings, style)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, settings, style: style || null })
}

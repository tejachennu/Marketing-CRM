import { NextRequest, NextResponse } from 'next/server'
import { getAiAccess } from '@/lib/ai-access'
import { runSalonAssistant } from '@/lib/salon/chat'
import { badRequest, salonAccess, serverError } from '@/lib/salon/server'

export const runtime = 'nodejs'
export const maxDuration = 30

// POST { organizationId, message, history? }: "Try it as a customer" — what the Front Desk assistant
// would answer on WhatsApp to a question asked during a booking. Nothing is sent. `reply` is null
// when the question is not about the business's services (on WhatsApp the FAQ chatbot answers those).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const message = String(body?.message ?? '').trim().slice(0, 500)
  if (!message) return badRequest('Type a question.')
  const { db, organizationId } = access.ctx
  try {
    const { data: organization } = await db.from('organizations').select('*').eq('id', organizationId).maybeSingle()
    const ai = await getAiAccess(db, organizationId, organization)
    if (!ai.allowed || !ai.apiKey) return NextResponse.json({ error: ai.reason || 'AI is not available right now.', aiPaused: true }, { status: 402 })
    const history = (Array.isArray(body?.history) ? body.history : [])
      .slice(-8)
      .map((m: any) => ({ role: m?.role === 'assistant' ? 'assistant' as const : 'user' as const, content: String(m?.content ?? '').slice(0, 500) }))
      .filter((m: { content: string }) => m.content)
    const collect: string[] = []
    const result = await runSalonAssistant({
      supabase: db, organization: organization || access.ctx.organization, contact: { id: '', first_name: 'Priya' }, conversationId: '', customerPhone: '',
      ai, message, history, collect,
    })
    return NextResponse.json({ success: true, reply: result.handled ? collect.join('\n\n') || null : null })
  } catch (error) {
    return serverError('try_question', error)
  }
}

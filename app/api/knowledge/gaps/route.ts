import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { aiFetch, getAiAccess } from '@/lib/ai-access'
import { listKnowledgeGaps, setKnowledgeGapStatus } from '@/lib/ai/knowledge-store'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET ?organizationId=&status=open|answered|ignored: questions the AI could not answer, most asked first
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const organizationId = params.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId)
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const status = (['open', 'answered', 'ignored'] as const).find((s) => s === params.get('status')) || 'open'
  return NextResponse.json({ gaps: await listKnowledgeGaps(getSupabaseAdminClient(), organizationId!, status) })
}

/**
 * POST { organizationId, id, action }
 *  - draft: an FAQ (question + answer) written by the AI from what the team replied in that chat; blanks to
 *    fill when the team has not answered it yet. Nothing is saved.
 *  - answered { faqId? }: the FAQ was added; ignore; reopen.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const organizationId = body?.organizationId
  const access = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!UUID.test(String(body?.id || ''))) return NextResponse.json({ error: 'Choose a question.' }, { status: 400 })
  const db = getSupabaseAdminClient()

  if (body.action === 'answered' || body.action === 'ignore' || body.action === 'reopen') {
    const status = body.action === 'answered' ? 'answered' : body.action === 'ignore' ? 'ignored' : 'open'
    const faqId = UUID.test(String(body?.faqId || '')) ? body.faqId : null
    const ok = await setKnowledgeGapStatus(db, organizationId, body.id, status, faqId)
    return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'That question is not there any more.' }, { status: 404 })
  }

  if (body.action !== 'draft') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  const { data: gap } = await db.from('knowledge_gaps').select('id, question, last_conversation_id').eq('id', body.id).eq('organization_id', organizationId).maybeSingle()
  if (!gap) return NextResponse.json({ error: 'That question is not there any more.' }, { status: 404 })
  const { data: org } = await db.from('organizations').select('*').eq('id', organizationId).maybeSingle()
  const ai = await getAiAccess(db, organizationId, org)
  if (!ai.allowed) return NextResponse.json({ error: ai.reason, aiPaused: true }, { status: 402 })

  // What the team wrote in that chat after the question (their own answer is the best material)
  let teamWords = ''
  if (gap.last_conversation_id) {
    const { data: rows } = await db.from('messages').select('sender_type, sender_id, body, created_at').eq('conversation_id', gap.last_conversation_id).order('created_at', { ascending: false }).limit(30)
    teamWords = (rows || []).reverse().filter((m: any) => m.body && !String(m.body).startsWith('[')).map((m: any) => `${m.sender_type === 'contact' ? 'Customer' : m.sender_id ? 'Team' : 'Bot'}: ${String(m.body).slice(0, 500)}`).join('\n').slice(-6000)
  }
  const prompt = `Write one FAQ entry for ${org?.name || 'a business'}'s WhatsApp chatbot, for this customer question:
"${gap.question}"

${teamWords ? `The chat where it was asked (use what the Team wrote as the facts):\n${teamWords}\n` : ''}
Rules:
- "title": the question in simple English, as a customer would ask it.
- "content": the answer in simple English, 1–4 short sentences. Use only facts the Team wrote above. Where a fact is not known, put a blank in square brackets for the business to fill, like [price] or [timings]. Never invent facts.
Answer in JSON: {"title": "...", "content": "..."}`
  try {
    const res = await aiFetch(db, ai, 'knowledge', 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', response_format: { type: 'json_object' }, temperature: 0.2, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(25000),
    })
    if (!res.ok) throw new Error('The AI did not answer.')
    const parsed = JSON.parse((await res.json())?.choices?.[0]?.message?.content || '{}')
    const title = String(parsed.title || gap.question).trim().slice(0, 300)
    const content = String(parsed.content || '').trim().slice(0, 3000)
    if (!content) throw new Error('The AI did not write an answer.')
    return NextResponse.json({ draft: { title, content }, fromTeam: Boolean(teamWords) })
  } catch (error: any) {
    return NextResponse.json({ error: `${error.message || 'The draft could not be written.'} Try again, or write the answer yourself.` }, { status: 502 })
  }
}

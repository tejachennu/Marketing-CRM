import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { aiFetch, getAiAccess } from '@/lib/ai-access'
import { insightBlocker, insightKindFor, insightPrompt, parseInsight, readMonth } from '@/lib/expenses/rules'
import { claimInsight, dropClaim, insightFacts, insightsFor, saveInsight } from '@/lib/expenses/store'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST { organizationId, month }: the month's AI review of sales (how it went, what to fix, sales ideas). Once a
 * month: one "so far" while the month is going on, and one for the full month after it ends. Charged to the AI
 * wallet like other AI features. A saved review is returned as it is.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'settings.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const organizationId = String(body.organizationId)
  const month = readMonth(body.month)
  const kind = insightKindFor(month)
  const db = getSupabaseAdminClient()

  const saved = await insightsFor(db, organizationId, month)
  const done = saved.find((row) => row.kind === 'full') || saved.find((row) => row.kind === kind)
  if (done) return NextResponse.json({ success: true, insight: done, already: true })

  const facts = await insightFacts(db, organizationId, month)
  const blocker = insightBlocker(facts.totals)
  if (blocker) return NextResponse.json({ error: blocker }, { status: 400 })

  const ai = await getAiAccess(db, organizationId)
  if (!ai.allowed) return NextResponse.json({ error: ai.reason, aiPaused: true }, { status: 402 })
  if (!(await claimInsight(db, organizationId, month, kind, access.user?.id || null))) {
    return NextResponse.json({ error: 'The review is being written. Open it again in a minute.' }, { status: 409 })
  }
  try {
    const response = await aiFetch(db, ai, 'sales_insight', 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 900,
        messages: [{ role: 'user', content: insightPrompt(facts) }],
      }),
      signal: AbortSignal.timeout(40000),
    })
    const data = await response.json().catch(() => ({}))
    const insight = response.ok ? parseInsight(data?.choices?.[0]?.message?.content) : null
    if (!insight) {
      if (!response.ok) console.error('[Sales insight]', data?.error?.message || response.status)
      await dropClaim(db, organizationId, month, kind)
      return NextResponse.json({ error: 'The review could not be written just now. Please try again.' }, { status: 502 })
    }
    const row = await saveInsight(db, organizationId, month, kind, insight, facts)
    return NextResponse.json({ success: true, insight: row })
  } catch (error: any) {
    console.error('[Sales insight]', error?.message)
    await dropClaim(db, organizationId, month, kind).catch(() => {})
    return NextResponse.json({ error: 'Writing took too long. Please try again.' }, { status: 504 })
  }
}

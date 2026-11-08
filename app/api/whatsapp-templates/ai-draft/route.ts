import { NextRequest, NextResponse } from 'next/server'
import { aiFetch, getAiAccess } from '@/lib/ai-access'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { perUserLimiter } from '@/lib/rate-limiter'
import { BUSINESS_TYPES, businessType } from '@/lib/salon/business'
import { MESSAGE_PURPOSES, type MessagePurpose } from '@/lib/salon/message-templates'
import { messageOrigin } from '@/lib/salon/jobs'
import { AI_TEMPLATE_SCHEMA, aiTemplateSystemPrompt, draftFromAi, type AiDraftRequest } from '@/lib/whatsapp-templates/ai-draft'
import { TEMPLATE_LANGUAGES } from '@/lib/whatsapp-templates/template-model'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST { organizationId, description, language?, category?, purpose? }: a template draft written by
 * AI from the description, checked against Meta's rules. Nothing is submitted here: the draft opens
 * in the editor (or Front Desk) to check, change and submit.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const organizationId = String(body?.organizationId || '')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'campaigns.manage' })
  if (!access.authorized) {
    // Front Desk managers set up its messages without managing campaigns
    const frontDesk = MESSAGE_PURPOSES.includes(body?.purpose) ? await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' }) : access
    if (!frontDesk.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const description = String(body?.description || '').trim().slice(0, 1500)
  if (description.length < 5) return NextResponse.json({ error: 'Describe the message in a few words: what it is for and what it should say.' }, { status: 400 })
  const language = TEMPLATE_LANGUAGES.some((l) => l.code === body?.language) ? String(body.language) : 'en'
  const purpose: MessagePurpose | null = MESSAGE_PURPOSES.includes(body?.purpose) ? body.purpose : null
  const limit = perUserLimiter.checkRateLimit(`template-ai:${organizationId}`, 30, 60 * 60 * 1000)
  if (!limit.allowed) return NextResponse.json({ error: 'That is a lot of drafts in an hour. Try again a little later.' }, { status: 429 })

  const db = getSupabaseAdminClient()
  const [{ data: organization }, { data: settings }] = await Promise.all([
    db.from('organizations').select('id, name, openai_api_key').eq('id', organizationId).maybeSingle(),
    db.from('salon_settings').select('business_name, business_type').eq('organization_id', organizationId).maybeSingle(),
  ])
  const ai = await getAiAccess(db, organizationId, organization)
  if (!ai.allowed) return NextResponse.json({ error: `${ai.reason || 'AI is not available.'} You can still write the template yourself.` }, { status: 402 })

  const draftRequest: AiDraftRequest = {
    description, language, purpose,
    category: body?.category === 'UTILITY' || body?.category === 'MARKETING' ? body.category : null,
    businessName: settings?.business_name || organization?.name || null,
    businessKind: settings ? BUSINESS_TYPES[businessType(settings.business_type)].describe : null,
  }
  const languageName = TEMPLATE_LANGUAGES.find((l) => l.code === language)?.label || 'English'
  try {
    const response = await aiFetch(db, ai, 'template_ai', 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        response_format: { type: 'json_schema', json_schema: AI_TEMPLATE_SCHEMA },
        messages: [
          { role: 'system', content: aiTemplateSystemPrompt(draftRequest) },
          { role: 'user', content: `Language: ${languageName} (${language}).\n${draftRequest.category ? `Category: ${draftRequest.category}.\n` : ''}What the message is for:\n${description}` },
        ],
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.error?.message || 'The AI could not write it.')
    const output = JSON.parse(String(data?.choices?.[0]?.message?.content || '{}'))
    const result = draftFromAi(output, draftRequest, messageOrigin(new URL(request.url).origin))
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    console.error('[Template AI]', error?.message || error)
    return NextResponse.json({ error: 'The AI could not write that template. Try describing it differently, or write it yourself.' }, { status: 502 })
  }
}

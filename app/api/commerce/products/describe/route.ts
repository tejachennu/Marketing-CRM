import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { aiFetch, getAiAccess } from '@/lib/ai-access'
import { describePrompt, readDescribeAnswer } from '@/lib/commerce/product-describe'
import { checkRateLimit } from '@/lib/rate-limiter'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST { organizationId, imageUrl, title?, category?, language? }: a name, description and category written
 * from the product photo. Charged to the AI wallet like other AI features.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'records.write' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!checkRateLimit(`product-describe:${body.organizationId}`, 60, 60 * 60_000).allowed) return NextResponse.json({ error: 'Many descriptions in a short time. Please wait a few minutes.' }, { status: 429 })
  const imageUrl = String(body?.imageUrl || '').trim()
  if (!/^https:\/\/\S{8,1000}$/.test(imageUrl)) return NextResponse.json({ error: 'Add a photo of the product first.' }, { status: 400 })
  const db = getSupabaseAdminClient()
  const ai = await getAiAccess(db, body.organizationId)
  if (!ai.allowed) return NextResponse.json({ error: ai.reason, aiPaused: true }, { status: 402 })
  const { data: org } = await db.from('organizations').select('name').eq('id', body.organizationId).maybeSingle()
  try {
    const response = await aiFetch(db, ai, 'product_description', 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 500,
        messages: [{ role: 'user', content: [
          { type: 'text', text: describePrompt({ title: body.title, category: body.category, shop: org?.name, language: body.language }) },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
        ] }],
      }),
      signal: AbortSignal.timeout(25000),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      console.error('[Product describe]', data?.error?.message || response.status)
      return NextResponse.json({ error: 'The photo could not be read. Try a clearer photo, or write it yourself.' }, { status: 502 })
    }
    const answer = readDescribeAnswer(data?.choices?.[0]?.message?.content)
    if (!answer) return NextResponse.json({ error: 'Nothing useful came back. Try again or write it yourself.' }, { status: 502 })
    return NextResponse.json({ success: true, ...answer })
  } catch (error: any) {
    console.error('[Product describe]', error?.message)
    return NextResponse.json({ error: 'Writing took too long. Please try again.' }, { status: 504 })
  }
}

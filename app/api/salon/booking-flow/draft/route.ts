import { NextRequest, NextResponse } from 'next/server'
import { aiFetch, getAiAccess } from '@/lib/ai-access'
import { parseSteps, STEP_NAMES } from '@/lib/salon/booking-flow-settings'
import { groupByCategory } from '@/lib/salon/categories'
import { MODEL } from '@/lib/salon/chat'
import { badRequest, loadSalonSetup, salonAccess, serverError } from '@/lib/salon/server'

export const runtime = 'nodejs'
export const maxDuration = 30

const SYSTEM = `You design WhatsApp booking flows for small Indian businesses (salons, clinics, studios, service centres).
The business describes how customers should book. Reply with JSON only:
{"welcome": string, "language": "en"|"te"|"hi", "steps": [step, ...]}

Step types (use only these):
- {"type":"services"}  customer picks services from the business's menu (required, exactly once)
- {"type":"staff"}     customer picks who serves them (only if the business wants it)
- {"type":"choice","text":question,"label":short name,"options":[2 to 10 short answers, each at most 24 characters]}
- {"type":"text","text":question,"label":short name}   customer types an answer (name, age, problem, car number…)
- {"type":"message","text":words}   a short note, no answer needed (e.g. "Please come 10 minutes early")
- {"type":"datetime"}  customer picks day and time (required, always the last step)

Rules: at most 12 steps. "services" before "staff". "datetime" last. Keep questions short and friendly,
the way a shopkeeper talks on WhatsApp. "label" is how the answer is saved on the booking (1 to 3 words).
"welcome" greets the customer: use {name} for their first name and {business} for the business name, and
end it with "Which service would you like?" (in the chosen language) when the first step is services.
Write in the language the business asks for; Telugu and Hindi as they are typed on WhatsApp in Latin
letters (Tenglish / Hinglish) unless they ask for the script. Ask only what the business asked for.`

// POST { organizationId, description }: AI drafts the booking flow's steps from the business's words.
// Nothing is saved: the draft comes back to edit and save.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const description = String(body?.description ?? '').trim().slice(0, 1500)
  if (description.length < 10) return badRequest('Tell the AI in a sentence or two how customers should book.')
  const { db, organizationId } = access.ctx
  try {
    const ai = await getAiAccess(db, organizationId)
    if (!ai.allowed || !ai.apiKey) return NextResponse.json({ error: ai.reason || 'AI is not available right now.', aiPaused: true }, { status: 402 })
    const setup = await loadSalonSetup(db, organizationId)
    const services = (setup.services || []).filter((s: any) => s.active)
    const categories = groupByCategory(setup.settings?.service_categories, services).filter(([, list]) => list.length > 0).map(([name, list]) => `${name} (${list.length})`).join(', ')
    const context = `Business: ${setup.settings?.business_name || 'the business'} (${setup.settings?.business_type || 'salon'}). Service categories: ${categories || 'none yet'}. Team: ${(setup.staff || []).filter((m: any) => m.active).length} people.`
    const res = await aiFetch(db, ai, 'booking_flow_draft', 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `${context}\n\nHow customers should book:\n${description}` }],
      }),
    })
    if (!res.ok) return NextResponse.json({ error: 'The AI could not draft the flow right now. Please try again.' }, { status: 502 })
    const data = await res.json()
    let draft: any = {}
    try { draft = JSON.parse(data.choices?.[0]?.message?.content || '{}') } catch { draft = {} }
    const { steps, notes } = parseSteps(draft.steps)
    return NextResponse.json({
      success: true,
      draft: {
        welcome: String(draft.welcome ?? '').trim().slice(0, 600),
        language: ['en', 'te', 'hi'].includes(draft.language) ? draft.language : undefined,
        steps,
      },
      notes,
      stepNames: STEP_NAMES,
    })
  } catch (error) {
    return serverError('booking flow draft', error)
  }
}

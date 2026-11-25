import { NextRequest, NextResponse } from 'next/server'
import { getMetaCredentials } from '@/lib/flows/meta-client'
import { appOrigin, badRequest, loadSalonSettings, salonAccess } from '@/lib/salon/server'
import { messagePurposesFor, takesAppointments } from '@/lib/salon/appointments-switch'
import { FRONT_DESK_MESSAGES, suggestionFor } from '@/lib/salon/templates'
import { listTemplates, type MetaTemplate } from '@/lib/whatsapp-templates/meta-templates'
import { MESSAGE_PURPOSES, parseMessageTemplates, templateBlanks, type MessagePurpose, type MessageTemplateChoice, type MessageTemplates } from '@/lib/salon/message-templates'
import { withSalonSchema } from '@/lib/salon/schema'
import { AUTO_LANGUAGES, autoView, nextChoice, settledChoice, templateParts } from '@/lib/whatsapp-templates/auto-messages'
import { autoProblems, metaErrorText, submitAutoTemplate } from '@/lib/whatsapp-templates/auto-submit'
import { billingRowFor } from '@/lib/billing-gate'
import { billingLimits } from '@/lib/billing'
import { planAllows, upgradeMessage } from '@/lib/plans'

import { logChange } from '@/lib/salon/change-log'

export const runtime = 'nodejs'
export const maxDuration = 30

async function credentialsFor(db: any, organizationId: string) {
  const { data: organization } = await db.from('organizations').select('*').eq('id', organizationId).maybeSingle()
  if (!organization) return { error: 'Workspace not found.' }
  if (organization.whatsapp_provider && organization.whatsapp_provider !== 'facebook') return { error: 'This workspace sends WhatsApp through Twilio; templates are managed in the Twilio console.' }
  try {
    return { credentials: getMetaCredentials(organization), organization }
  } catch {
    return { error: 'Connect WhatsApp (Meta Cloud API) in Settings to use message templates.' }
  }
}

/** The workspace's own templates, with how many blanks each has, to pick one for a message. */
function accountTemplates(list: MetaTemplate[]) {
  return list
    .filter((t) => !['DELETED', 'DISABLED'].includes(t.status))
    .map((t) => ({ name: t.name, language: t.language, status: t.status, category: t.category, body: templateParts(t).body, quickReplies: templateParts(t).buttons.filter((b) => b.type === 'QUICK_REPLY').length, ...templateBlanks(t) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language))
}

async function savedChoices(db: any, organizationId: string): Promise<MessageTemplates> {
  const { data } = await db.from('salon_settings').select('message_templates').eq('organization_id', organizationId).maybeSingle()
  const parsed = parseMessageTemplates(data?.message_templates)
  return 'value' in parsed ? parsed.value : {}
}

async function saveChoices(db: any, organizationId: string, choices: MessageTemplates) {
  return withSalonSchema(() => db.from('salon_settings')
    .upsert({ organization_id: organizationId, message_templates: choices, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' }).select('organization_id').single())
}

/** Own templates need the business's own WhatsApp (Growth and Pro). A billing read error never locks anyone out. */
async function ownWhatsApp(db: any, organizationId: string): Promise<boolean> {
  return billingRowFor(db, organizationId).then((row) => planAllows(billingLimits(row), 'templates')).catch(() => true)
}

async function businessName(db: any, organizationId: string, fallback: string | null) {
  const { data } = await db.from('salon_settings').select('business_name').eq('organization_id', organizationId).maybeSingle()
  return data?.business_name || fallback || null
}

// GET ?organizationId: each message with its suggested text and the template set up for it (where it stands with
// Meta), the workspace's own templates to pick from (managers and up). Nothing is set up until the business does it.
// Without appointments (Setup → Appointments) the booking and reminder messages are left out: they are never sent.
export async function GET(request: NextRequest) {
  const access = await salonAccess(request, new URL(request.url).searchParams.get('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  const { db, organizationId, organization } = access.ctx
  let choices = await savedChoices(db, organizationId).catch(() => ({} as MessageTemplates))
  const suggestions = Object.fromEntries(MESSAGE_PURPOSES.map((purpose) => [purpose, suggestionFor(purpose, appOrigin(request))]))
  const [own, business, settings] = await Promise.all([ownWhatsApp(db, organizationId), businessName(db, organizationId, organization?.name).catch(() => organization?.name || null), loadSalonSettings(db, organizationId).catch(() => null)])
  const purposes = messagePurposesFor(MESSAGE_PURPOSES, takesAppointments(settings))
  const views = (account: MetaTemplate[], checked: boolean) => purposes.map((purpose) => autoView(FRONT_DESK_MESSAGES[purpose], choices[purpose], account, { checked, business }))
  const base = { success: true, ownWhatsApp: own, languages: AUTO_LANGUAGES, suggestions }
  const { credentials, error } = await credentialsFor(db, organizationId)
  if (!credentials) return NextResponse.json({ ...base, connected: false, message: error, account: [], choices, autoMessages: views([], false) })
  let list: MetaTemplate[]
  try {
    list = await listTemplates(credentials)
  } catch (err) {
    return NextResponse.json({ ...base, connected: true, message: `Could not check with Meta right now: ${metaErrorText(err)}`, account: [], choices, autoMessages: views([], false) })
  }
  // A newer wording Meta has approved no longer needs the earlier one kept for it
  const settled = Object.fromEntries(Object.entries(choices).map(([purpose, choice]) => [purpose, choice && settledChoice(choice, list) as MessageTemplateChoice]))
  if (JSON.stringify(settled) !== JSON.stringify(choices)) {
    choices = settled
    await saveChoices(db, organizationId, choices).catch(() => null)
  }
  return NextResponse.json({ ...base, connected: true, account: accountTemplates(list), choices, autoMessages: views(list, true) }, { headers: { 'Cache-Control': 'no-store' } })
}

// POST { organizationId, purpose, text, language, buttons, check? }: send the business's wording for one message to
// Meta for approval (a new template under a free name); it is set up for that message, and the earlier approved one
// keeps going out until Meta approves the new one. { check: true } only says what still needs fixing.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const { db, organizationId } = access.ctx
  const purpose = body?.purpose as MessagePurpose
  if (!MESSAGE_PURPOSES.includes(purpose)) return badRequest('That is not a message Front Desk sends.')
  const def = FRONT_DESK_MESSAGES[purpose]
  const input = { text: String(body?.text ?? '').slice(0, 2000), language: String(body?.language || 'en'), buttons: Array.isArray(body?.buttons) ? body.buttons.slice(0, 3).map((b: unknown) => String(b ?? '').slice(0, 40)) : undefined }
  if (body?.check === true) return NextResponse.json({ success: true, problems: autoProblems(def, input, appOrigin(request)) })
  if (!(await ownWhatsApp(db, organizationId))) return NextResponse.json({ error: upgradeMessage('templates') }, { status: 402 })
  const { credentials, error } = await credentialsFor(db, organizationId)
  if (!credentials) return badRequest(error || 'Connect WhatsApp in Settings first.')
  let account: MetaTemplate[]
  try {
    account = await listTemplates(credentials)
  } catch (err) {
    return NextResponse.json({ error: `Could not reach Meta right now: ${metaErrorText(err)}` }, { status: 422 })
  }
  const result = await submitAutoTemplate(credentials, def, input, { origin: appOrigin(request), account })
  if (!result.ok) return NextResponse.json({ error: result.error, problems: result.problems || [] }, { status: result.status })

  const choices = await savedChoices(db, organizationId).catch(() => ({} as MessageTemplates))
  const old = choices[purpose] || null
  const made = nextChoice(old, { name: result.name, language: result.language, fields: result.fields }, account)
  const previous = made.previous ? { ...made.previous, url_field: (made.previous.name === old?.name ? old?.url_field : old?.previous?.url_field) ?? null } : null
  const choice = { name: made.name, language: made.language, fields: made.fields, url_field: def.urlField || null, ...(previous ? { previous } : {}) } as MessageTemplateChoice
  const { error: saveError } = await saveChoices(db, organizationId, { ...choices, [purpose]: choice })
  if (saveError) return NextResponse.json({ error: `Sent to Meta as ${result.name}, but it could not be set up here. Pick it with "Use one I already have" once it is approved.` }, { status: 500 })
  await logChange(access.ctx, { area: 'templates', action: 'sent for approval', target: def.title, details: { template: result.name, language: result.language } })
  return NextResponse.json({ success: true, choice, status: result.status, category: result.category })
}

// PUT { organizationId, choices }: which template goes out for each message (a message left out has none set up)
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const parsed = parseMessageTemplates(body?.choices)
  if ('error' in parsed) return badRequest(parsed.error)
  const { db, organizationId } = access.ctx
  const { error } = await saveChoices(db, organizationId, parsed.value)
  if (error) return NextResponse.json({ error: 'The choices could not be saved. Please try again.' }, { status: 500 })
  await logChange(access.ctx, { area: 'templates', action: 'changed', details: Object.fromEntries(Object.entries(parsed.value).map(([k, v]: [string, any]) => [k, v?.name || 'none'])) })
  return NextResponse.json({ success: true, choices: parsed.value })
}

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient, verifyOrgAccess } from '@/lib/api-auth-helper'
import { getMetaCredentials } from '@/lib/flows/meta-client'
import { SHOP_MESSAGE_DEFS, SHOP_MESSAGE_INFO, SHOP_PURPOSES, readShopMessages, shopFieldKeys, type ShopMessageSetting, type ShopPurpose } from '@/lib/commerce/shop-messages'
import { withSalesSchema } from '@/lib/commerce/shop-sales-store'
import { AUTO_LANGUAGES, autoView, blankCount, nextChoice, settledChoice, templateParts, type AutoChoice } from '@/lib/whatsapp-templates/auto-messages'
import { autoProblems, metaErrorText, submitAutoTemplate } from '@/lib/whatsapp-templates/auto-submit'
import { listTemplates, type MetaTemplate } from '@/lib/whatsapp-templates/meta-templates'
import { billingRowFor } from '@/lib/billing-gate'
import { billingLimits } from '@/lib/billing'
import { planAllows } from '@/lib/plans'

export const runtime = 'nodejs'
export const maxDuration = 30

/** The app's own address: the shop's messages carry their links in the text, so this only matters for checks. */
const appOrigin = (request: NextRequest) => (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '') || new URL(request.url).origin

/** A shop setting as the template editor sees it (and back). */
const asChoice = (purpose: ShopPurpose, s: { template: string; language: string; fields?: string[] }): AutoChoice | null =>
  s.template ? { name: s.template, language: s.language, fields: s.fields || shopFieldKeys(purpose) } : null

function withChoice(setting: ShopMessageSetting, choice: AutoChoice): ShopMessageSetting {
  const next: ShopMessageSetting = { on: setting.on, template: choice.name, language: choice.language, fields: choice.fields }
  if (choice.previous) next.previous = { template: choice.previous.name, language: choice.previous.language, fields: choice.previous.fields }
  return next
}

async function loadOrg(organizationId: string) {
  const { data } = await withSalesSchema(() => getSupabaseAdminClient().from('organizations').select('*').eq('id', organizationId).maybeSingle())
  return data || null
}

async function saveMessages(organizationId: string, messages: Record<ShopPurpose, ShopMessageSetting>) {
  const clean = Object.fromEntries(SHOP_PURPOSES.map((p) => [p, messages[p]]))
  return withSalesSchema(() => getSupabaseAdminClient().from('organizations').update({ shop_messages: clean }).eq('id', organizationId))
}

function credentialsOf(org: any): { credentials?: ReturnType<typeof getMetaCredentials>; error?: string } {
  if (!org) return { error: 'Workspace not found.' }
  if (org.whatsapp_provider && org.whatsapp_provider !== 'facebook') return { error: 'This workspace sends WhatsApp through Twilio; templates are managed in the Twilio console.' }
  try {
    return { credentials: getMetaCredentials(org) }
  } catch {
    return { error: 'Connect WhatsApp (Meta Cloud API) in Settings to use message templates.' }
  }
}

/** The shop's own WhatsApp comes with Business and up; a billing read error never locks anyone out. */
async function ownWhatsApp(organizationId: string) {
  return billingRowFor(getSupabaseAdminClient(), organizationId).then((row) => planAllows(billingLimits(row), 'templates')).catch(() => true)
}

function accountTemplates(list: MetaTemplate[]) {
  return list
    .filter((t) => !['DELETED', 'DISABLED'].includes(t.status))
    .map((t) => {
      const parts = templateParts(t)
      return { name: t.name, language: t.language, status: t.status, category: t.category, body: parts.body, blanks: blankCount(parts.body), urlButton: parts.buttons.some((b) => b.type === 'URL' && /\{\{\s*1\s*\}\}/.test(String(b.url || ''))), quickReplies: parts.buttons.filter((b) => b.type === 'QUICK_REPLY').length }
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language))
}

// GET ?organizationId=: which shop WhatsApp messages are on, each one's suggested wording and the template set up for
// it (where it stands with Meta), and the shop's own templates to pick from
export async function GET(request: NextRequest) {
  const organizationId = new URL(request.url).searchParams.get('organizationId')
  const access = await verifyOrgAccess(request, organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const org = await loadOrg(organizationId!)
  let messages = readShopMessages(org?.shop_messages)
  const own = await ownWhatsApp(organizationId!)
  const business = org?.storefront?.title || org?.name || null
  const views = (account: MetaTemplate[], checked: boolean) => SHOP_PURPOSES.map((p) => ({
    ...autoView(SHOP_MESSAGE_DEFS[p], asChoice(p, messages[p]), account, { checked, business }),
    on: messages[p].on,
    switchable: SHOP_MESSAGE_INFO[p].switchable !== false,
  }))
  const base = { messages, ownWhatsApp: own, languages: AUTO_LANGUAGES }
  const { credentials, error } = credentialsOf(org)
  if (!credentials) return NextResponse.json({ ...base, connected: false, message: error, account: [], autoMessages: views([], false) })
  let list: MetaTemplate[]
  try {
    list = await listTemplates(credentials)
  } catch (err) {
    return NextResponse.json({ ...base, connected: true, message: `Could not check with Meta right now: ${metaErrorText(err)}`, account: [], autoMessages: views([], false) })
  }
  // A newer wording Meta has approved no longer needs the earlier one kept for it
  const settled = { ...messages }
  for (const p of SHOP_PURPOSES) {
    const choice = asChoice(p, messages[p])
    if (choice && messages[p].previous) {
      const prev = messages[p].previous!
      const done = settledChoice({ ...choice, previous: { name: prev.template, language: prev.language, fields: prev.fields || shopFieldKeys(p) } }, list)
      if (!done.previous) { settled[p] = { ...messages[p] }; delete settled[p].previous }
    }
  }
  if (JSON.stringify(settled) !== JSON.stringify(messages)) {
    messages = settled
    await saveMessages(organizationId!, messages).catch(() => null)
  }
  return NextResponse.json({ ...base, messages, connected: true, account: accountTemplates(list), autoMessages: views(list, true) }, { headers: { 'Cache-Control': 'no-store' } })
}

// POST { organizationId, purpose, text, language, buttons, check? }: send the shop's wording for one message to Meta for
// approval (a new template under a free name); it is set up for that message, and the earlier approved one keeps going
// out until Meta approves the new one. { check: true } only says what still needs fixing.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const purpose = body?.purpose as ShopPurpose
  if (!SHOP_PURPOSES.includes(purpose)) return NextResponse.json({ error: 'That is not a message the shop sends.' }, { status: 400 })
  const def = SHOP_MESSAGE_DEFS[purpose]
  const input = { text: String(body?.text ?? '').slice(0, 2000), language: String(body?.language || 'en'), buttons: Array.isArray(body?.buttons) ? body.buttons.slice(0, 3).map((b: unknown) => String(b ?? '').slice(0, 40)) : undefined }
  if (body?.check === true) return NextResponse.json({ success: true, problems: autoProblems(def, input, appOrigin(request)) })
  // Plan: refused like the Templates page (402), with the same words
  const plan = await verifyOrgAccess(request, body.organizationId, { permission: 'automation.manage', feature: 'templates' })
  if (!plan.authorized) return NextResponse.json({ error: plan.error }, { status: plan.status })
  const org = await loadOrg(body.organizationId)
  const { credentials, error } = credentialsOf(org)
  if (!credentials) return NextResponse.json({ error }, { status: 400 })
  let account: MetaTemplate[]
  try {
    account = await listTemplates(credentials)
  } catch (err) {
    return NextResponse.json({ error: `Could not reach Meta right now: ${metaErrorText(err)}` }, { status: 422 })
  }
  const result = await submitAutoTemplate(credentials, def, input, { origin: appOrigin(request), account })
  if (!result.ok) return NextResponse.json({ error: result.error, problems: result.problems || [] }, { status: result.status })

  const messages = readShopMessages(org?.shop_messages)
  const current = messages[purpose]
  const old = asChoice(purpose, current)
  if (old && current.previous) old.previous = { name: current.previous.template, language: current.previous.language, fields: current.previous.fields || shopFieldKeys(purpose) }
  const choice = nextChoice(old, { name: result.name, language: result.language, fields: result.fields }, account)
  const next = { ...messages, [purpose]: withChoice(current, choice) }
  const { error: saveError } = await saveMessages(body.organizationId, next)
  if (saveError) return NextResponse.json({ error: `Sent to Meta as ${result.name}, but it could not be set up here. Pick it with "Use one I already have" once it is approved.` }, { status: 500 })
  return NextResponse.json({ success: true, setting: next[purpose], status: result.status, category: result.category })
}

// PUT { organizationId, messages: { <purpose>: { on, template, language, fields? } } }: switch messages on / off
// PUT { organizationId, purpose, pick: { template, language, fields } | null }: use one of the shop's own approved
// templates for a message (null: stop using a template for it)
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await verifyOrgAccess(request, body?.organizationId, { permission: 'automation.manage' })
  if (!access.authorized) return NextResponse.json({ error: access.error }, { status: access.status })
  const stored = readShopMessages((await loadOrg(body.organizationId))?.shop_messages)
  if (body?.pick !== undefined) {
    const purpose = body?.purpose as ShopPurpose
    if (!SHOP_PURPOSES.includes(purpose)) return NextResponse.json({ error: 'That is not a message the shop sends.' }, { status: 400 })
    const picked = body.pick ? readShopMessages({ [purpose]: { ...body.pick, on: stored[purpose].on } })[purpose] : { on: stored[purpose].on, template: '', language: 'en' }
    if (body.pick && (!picked.template || !picked.fields)) return NextResponse.json({ error: 'Choose a template and what fills each of its blanks.' }, { status: 400 })
    const next = { ...stored, [purpose]: picked }
    const { error } = await saveMessages(body.organizationId, next)
    if (error) return NextResponse.json({ error: error.message || 'Could not save.' }, { status: 500 })
    return NextResponse.json({ success: true, messages: next })
  }
  const messages = readShopMessages(body?.messages)
  // A template name typed in (older app) keeps the blank list of the template it replaced: use the usual order
  for (const p of SHOP_PURPOSES) {
    const m = messages[p]
    if (m.template !== stored[p].template && JSON.stringify(m.fields) === JSON.stringify(stored[p].fields)) {
      delete m.fields
      delete m.previous
    }
  }
  const { error } = await saveMessages(body.organizationId, messages)
  if (error) return NextResponse.json({ error: error.message || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ success: true, messages })
}

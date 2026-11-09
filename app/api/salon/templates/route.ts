import { NextRequest, NextResponse } from 'next/server'
import { getMetaCredentials } from '@/lib/flows/meta-client'
import { appOrigin, badRequest, salonAccess } from '@/lib/salon/server'
import { suggestionFor } from '@/lib/salon/templates'
import { listTemplates, type MetaTemplate } from '@/lib/whatsapp-templates/meta-templates'
import { MESSAGE_PURPOSES, parseMessageTemplates, templateBlanks } from '@/lib/salon/message-templates'
import { withSalonSchema } from '@/lib/salon/schema'

import { logChange } from '@/lib/salon/change-log'

export const runtime = 'nodejs'
export const maxDuration = 30

async function credentialsFor(db: any, organizationId: string) {
  const { data: organization } = await db.from('organizations').select('*').eq('id', organizationId).maybeSingle()
  if (!organization) return { error: 'Workspace not found.' }
  if (organization.whatsapp_provider && organization.whatsapp_provider !== 'facebook') return { error: 'This workspace sends WhatsApp through Twilio; templates are managed in the Twilio console.' }
  try {
    return { credentials: getMetaCredentials(organization) }
  } catch {
    return { error: 'Connect WhatsApp (Meta Cloud API) in Settings to use message templates.' }
  }
}

const metaMessage = (error: any) => error?.details?.[0]?.error_user_msg || error?.details?.[0]?.error_user_title || (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(String(error?.message || '')) ? 'Meta could not be reached. Check your connection and try again' : error?.message) || 'Meta did not accept it.'

/** The workspace's own templates, with how many blanks each has, to pick one for a message. */
function accountTemplates(list: MetaTemplate[]) {
  return list
    .filter((t) => !['DELETED', 'DISABLED'].includes(t.status))
    .map((t) => ({ name: t.name, language: t.language, status: t.status, category: t.category, body: String(t.components?.find((c: any) => String(c?.type).toUpperCase() === 'BODY')?.text || ''), ...templateBlanks(t) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language))
}

async function savedChoices(db: any, organizationId: string) {
  const { data } = await db.from('salon_settings').select('message_templates').eq('organization_id', organizationId).maybeSingle()
  const parsed = parseMessageTemplates(data?.message_templates)
  return 'value' in parsed ? parsed.value : {}
}

// GET ?organizationId: the workspace's own templates, which one is set up for each message, and
// suggested texts to start from (managers and up). Nothing is set up until the business does it.
export async function GET(request: NextRequest) {
  const access = await salonAccess(request, new URL(request.url).searchParams.get('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  const choices = await savedChoices(access.ctx.db, access.ctx.organizationId).catch(() => ({}))
  const suggestions = Object.fromEntries(MESSAGE_PURPOSES.map((purpose) => [purpose, suggestionFor(purpose, appOrigin(request))]))
  const { credentials, error } = await credentialsFor(access.ctx.db, access.ctx.organizationId)
  if (!credentials) return NextResponse.json({ success: true, connected: false, message: error, account: [], choices, suggestions })
  try {
    return NextResponse.json({ success: true, connected: true, account: accountTemplates(await listTemplates(credentials)), choices, suggestions })
  } catch (err) {
    return NextResponse.json({ success: true, connected: true, message: `Could not check with Meta right now: ${metaMessage(err)}`, account: [], choices, suggestions })
  }
}

// PUT { organizationId, choices }: which template goes out for each message (a message left out has none set up)
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const parsed = parseMessageTemplates(body?.choices)
  if ('error' in parsed) return badRequest(parsed.error)
  const { db, organizationId } = access.ctx
  const { error } = await withSalonSchema(() => db.from('salon_settings')
    .upsert({ organization_id: organizationId, message_templates: parsed.value, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' }).select('organization_id').single())
  if (error) return NextResponse.json({ error: 'The choices could not be saved. Please try again.' }, { status: 500 })
  await logChange(access.ctx, { area: 'templates', action: 'changed', details: Object.fromEntries(Object.entries(parsed.value).map(([k, v]: [string, any]) => [k, v?.name || 'none'])) })
  return NextResponse.json({ success: true, choices: parsed.value })
}

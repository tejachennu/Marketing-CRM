import { NextRequest, NextResponse } from 'next/server'
import { getMetaCredentials } from '@/lib/flows/meta-client'
import { appOrigin, badRequest, salonAccess } from '@/lib/salon/server'
import { packStatus, SALON_TEMPLATES, templateDraft, type SalonTemplateKey } from '@/lib/salon/templates'
import { createTemplate, listTemplates, type MetaTemplate } from '@/lib/whatsapp-templates/meta-templates'
import { parseMessageTemplates, templateBlanks } from '@/lib/salon/message-templates'
import { withSalonSchema } from '@/lib/salon/schema'

export const runtime = 'nodejs'
export const maxDuration = 60

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

async function statuses(credentials: any) {
  return packStatus(await listTemplates(credentials))
}

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

// GET ?organizationId: the built-in templates and where each stands on Meta, the workspace's own
// templates, and which template goes out for each message (managers and up)
export async function GET(request: NextRequest) {
  const access = await salonAccess(request, new URL(request.url).searchParams.get('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  const choices = await savedChoices(access.ctx.db, access.ctx.organizationId).catch(() => ({}))
  const { credentials, error } = await credentialsFor(access.ctx.db, access.ctx.organizationId)
  if (!credentials) return NextResponse.json({ success: true, connected: false, message: error, templates: packStatus([]), account: [], choices })
  try {
    const list = await listTemplates(credentials)
    return NextResponse.json({ success: true, connected: true, templates: packStatus(list), account: accountTemplates(list), choices })
  } catch (err) {
    // Still show the pack, saying Meta could not be asked
    return NextResponse.json({ success: true, connected: true, message: `Could not check with Meta right now: ${metaMessage(err)}`, templates: packStatus(null), account: [], choices })
  }
}

// PUT { organizationId, choices }: which template goes out for each message (a message left out uses the built-in one)
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
  return NextResponse.json({ success: true, choices: parsed.value })
}

// POST { organizationId, keys? }: submit the templates not on Meta yet (all of them, or the ones named)
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await salonAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const { credentials, error } = await credentialsFor(access.ctx.db, access.ctx.organizationId)
  if (!credentials) return badRequest(error || 'WhatsApp is not connected.')
  const wanted = new Set<SalonTemplateKey>(Array.isArray(body?.keys) && body.keys.length ? body.keys : SALON_TEMPLATES.map((t) => t.key))
  try {
    const current = await statuses(credentials)
    const results: Record<string, { ok: boolean; status?: string; error?: string }> = {}
    for (const template of SALON_TEMPLATES) {
      if (!wanted.has(template.key)) continue
      const existing = current.find((t) => t.key === template.key)
      if (existing && existing.status !== 'NOT_SUBMITTED') { results[template.key] = { ok: true, status: existing.status }; continue }
      try {
        const created = await createTemplate(credentials, templateDraft(template, appOrigin(request)))
        results[template.key] = { ok: true, status: String(created?.status || 'PENDING').toUpperCase() }
      } catch (err) {
        results[template.key] = { ok: false, error: metaMessage(err) }
      }
    }
    return NextResponse.json({ success: true, results, templates: await statuses(credentials) })
  } catch (err) {
    return NextResponse.json({ error: metaMessage(err) }, { status: 502 })
  }
}

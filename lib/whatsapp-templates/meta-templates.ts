/**
 * Message templates on Meta, through the Graph API with the organization's own WhatsApp
 * connection (the business token Embedded Signup issues to WAMACRM as a Tech Provider).
 */

import { metaRequest, type MetaCredentials } from '@/lib/flows/meta-client'
import { buildComponents, buildCreatePayload, type TemplateDraft } from './template-model'

const LIST_FIELDS = 'id,name,status,category,language,components,quality_score,rejected_reason,previous_category,parameter_format,sub_category'
const MAX_PAGES = 20 // 2,000 templates

export interface MetaTemplate {
  id: string
  name: string
  status: string
  category: string
  language: string
  components: any[]
  quality_score?: { score?: string } | null
  rejected_reason?: string | null
  previous_category?: string | null
  parameter_format?: string | null
  sub_category?: string | null
}

/** Every template on the WhatsApp Business account, all statuses and languages. */
export async function listTemplates(credentials: MetaCredentials, fetcher: typeof fetch = fetch): Promise<MetaTemplate[]> {
  const templates: MetaTemplate[] = []
  let path: string | null = `${credentials.businessAccountId}/message_templates?fields=${LIST_FIELDS}&limit=100`
  for (let page = 0; path && page < MAX_PAGES; page++) {
    const data: any = await metaRequest(credentials, path, { cache: 'no-store' } as RequestInit, fetcher)
    templates.push(...(data.data || []))
    const next: string | undefined = data.paging?.next
    // The next page as a path relative to the Graph API version
    path = next ? next.replace(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\//, '') : null
  }
  return templates
}

/** Submit a new template for review. Meta answers with its id, status and category. */
export async function createTemplate(credentials: MetaCredentials, draft: TemplateDraft, fetcher: typeof fetch = fetch) {
  return metaRequest(credentials, `${credentials.businessAccountId}/message_templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCreatePayload(draft)),
  }, fetcher) as Promise<{ id: string; status: string; category: string }>
}

/**
 * Edit a template's content (and category, while it is not approved). Meta allows an approved
 * template one edit a day and ten a month; the name and language never change.
 */
export async function editTemplate(credentials: MetaCredentials, templateId: string, draft: TemplateDraft, options: { changeCategory: boolean }, fetcher: typeof fetch = fetch) {
  return metaRequest(credentials, templateId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ components: buildComponents(draft), ...(options.changeCategory ? { category: draft.category } : {}) }),
  }, fetcher) as Promise<{ success: boolean }>
}

/** Delete one language of a template (by its id), or every language of the name. */
export async function deleteTemplate(credentials: MetaCredentials, name: string, templateId: string | null, fetcher: typeof fetch = fetch) {
  const query = new URLSearchParams({ name, ...(templateId ? { hsm_id: templateId } : {}) })
  return metaRequest(credentials, `${credentials.businessAccountId}/message_templates?${query}`, { method: 'DELETE' }, fetcher) as Promise<{ success: boolean }>
}

/**
 * Upload a sample image, video or document for a header with Meta's Resumable Upload API.
 * Returns the handle ("4::…") a template's example takes.
 */
export async function uploadSampleMedia(
  credentials: MetaCredentials,
  appId: string,
  file: { name: string; type: string; bytes: ArrayBuffer },
  fetcher: typeof fetch = fetch
): Promise<string> {
  const query = new URLSearchParams({ file_name: file.name.slice(0, 100) || 'sample', file_length: String(file.bytes.byteLength), file_type: file.type })
  const session = await metaRequest(credentials, `${appId}/uploads?${query}`, { method: 'POST' }, fetcher)
  if (!session?.id) throw new Error('Meta did not start the upload.')
  const response = await fetcher(`https://graph.facebook.com/${credentials.version}/${session.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${credentials.token}`, file_offset: '0', 'Content-Type': file.type },
    body: file.bytes,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.h) throw new Error(data?.error?.error_user_msg || data?.error?.message || 'Meta did not accept the file.')
  return String(data.h)
}

// ── Template library (Meta's pre-approved templates) ────────────────────────

export interface LibraryTemplate {
  id?: string
  name: string
  language: string
  category: string
  topic?: string
  usecase?: string
  industry?: string[]
  header?: string
  body: string
  body_params?: string[]
  buttons?: Array<{ type: string; text?: string; url?: string; phone_number?: string }>
}

/** Search Meta's template library. */
export async function listLibrary(
  credentials: MetaCredentials,
  filters: { search?: string; topic?: string; language?: string },
  fetcher: typeof fetch = fetch
): Promise<LibraryTemplate[]> {
  const query = new URLSearchParams({ limit: '100' })
  if (filters.search) query.set('search', filters.search.slice(0, 100))
  if (filters.topic) query.set('topic', filters.topic)
  if (filters.language) query.set('language', filters.language)
  const data = await metaRequest(credentials, `message_template_library?${query}`, { cache: 'no-store' } as RequestInit, fetcher)
  return data.data || []
}

export interface LibraryButtonInput {
  type: 'URL' | 'PHONE_NUMBER'
  url?: { base_url: string; url_suffix_example?: string }
  phone_number?: string
}

/** Create a template from the library. Library templates are approved as soon as they are created. */
export async function createFromLibrary(
  credentials: MetaCredentials,
  input: { name: string; language: string; libraryName: string; buttonInputs: LibraryButtonInput[] },
  fetcher: typeof fetch = fetch
) {
  return metaRequest(credentials, `${credentials.businessAccountId}/message_templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      language: input.language,
      category: 'UTILITY',
      library_template_name: input.libraryName,
      ...(input.buttonInputs.length ? { library_template_button_inputs: input.buttonInputs } : {}),
    }),
  }, fetcher) as Promise<{ id: string; status: string; category: string }>
}

// ── Template insights (sent, delivered, read and button clicks) ─────────────

export interface TemplateInsightDay {
  start: number
  sent: number
  delivered: number
  read: number
  clicked: Array<{ type: string; button_content: string; count: number }>
}

export interface TemplateInsights {
  days: TemplateInsightDay[]
  totals: { sent: number; delivered: number; read: number; clicked: number }
  buttons: Array<{ text: string; type: string; count: number }>
}

const INSIGHTS_DAYS_MAX = 90

/** Turn on template analytics for the WhatsApp Business account (Meta requires it once). */
export async function enableInsights(credentials: MetaCredentials, fetcher: typeof fetch = fetch) {
  return metaRequest(credentials, `${credentials.businessAccountId}?is_enabled_for_insights=true`, { method: 'POST' }, fetcher)
}

/** Sum Meta's daily data points for one template into a chart-ready series. */
export function summarizeInsights(dataPoints: any[], days: number, now = Date.now()): TemplateInsights {
  const byDay = new Map<number, TemplateInsightDay>()
  for (const point of dataPoints) {
    const start = Number(point.start) || 0
    const day = byDay.get(start) || { start, sent: 0, delivered: 0, read: 0, clicked: [] }
    day.sent += Number(point.sent) || 0
    day.delivered += Number(point.delivered) || 0
    day.read += Number(point.read) || 0
    day.clicked.push(...(Array.isArray(point.clicked) ? point.clicked : []))
    byDay.set(start, day)
  }
  // Every day in the range, so the chart has no gaps
  const today = Math.floor(now / 86_400_000) * 86_400
  const series: TemplateInsightDay[] = []
  for (let offset = days - 1; offset >= 0; offset--) {
    const start = today - offset * 86_400
    series.push(byDay.get(start) || { start, sent: 0, delivered: 0, read: 0, clicked: [] })
  }
  const buttons = new Map<string, { text: string; type: string; count: number }>()
  for (const day of byDay.values()) {
    for (const click of day.clicked) {
      const key = `${click.type}:${click.button_content}`
      const entry = buttons.get(key) || { text: String(click.button_content || ''), type: String(click.type || ''), count: 0 }
      entry.count += Number(click.count) || 0
      buttons.set(key, entry)
    }
  }
  const values = [...byDay.values()]
  const sum = (key: 'sent' | 'delivered' | 'read') => values.reduce((total, day) => total + day[key], 0)
  const clickList = [...buttons.values()].sort((a, b) => b.count - a.count)
  return {
    days: series,
    totals: { sent: sum('sent'), delivered: sum('delivered'), read: sum('read'), clicked: clickList.reduce((total, button) => total + button.count, 0) },
    buttons: clickList,
  }
}

/**
 * A template's performance for the last `days` days (up to 90), from Meta's template analytics.
 * Turns analytics on for the account the first time, as WhatsApp Manager does.
 */
export async function templateInsights(credentials: MetaCredentials, templateId: string, days: number, fetcher: typeof fetch = fetch): Promise<TemplateInsights> {
  const range = Math.min(Math.max(Math.round(days) || 7, 1), INSIGHTS_DAYS_MAX)
  const end = Math.floor(Date.now() / 1000)
  const start = Math.floor(Date.now() / 86_400_000) * 86_400 - (range - 1) * 86_400
  const query = new URLSearchParams({
    start: String(start),
    end: String(end),
    granularity: 'DAILY',
    metric_types: JSON.stringify(['SENT', 'DELIVERED', 'READ', 'CLICKED']),
    template_ids: JSON.stringify([templateId]),
  })
  const path = `${credentials.businessAccountId}/template_analytics?${query}`
  let data: any
  try {
    data = await metaRequest(credentials, path, { cache: 'no-store' } as RequestInit, fetcher)
  } catch (error: any) {
    if (!/enabl|insight|analytics/i.test(String(error?.message || ''))) throw error
    await enableInsights(credentials, fetcher)
    data = await metaRequest(credentials, path, { cache: 'no-store' } as RequestInit, fetcher)
  }
  const points = (data.data || []).flatMap((entry: any) => entry.data_points || [])
  return summarizeInsights(points, range)
}

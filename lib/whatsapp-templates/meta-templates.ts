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

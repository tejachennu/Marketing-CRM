import type { MetaFlowJSON } from './flow-types'

export interface MetaCredentials { token: string; version: string; businessAccountId: string; phoneNumberId: string }
export function getMetaCredentials(organization: Record<string, any>): MetaCredentials {
  if (organization?.whatsapp_provider !== 'facebook') throw new Error('Connect WhatsApp Cloud API in Settings before using flows')
  // Never use another organization's environment credentials.
  const credentials = { token: organization.whatsapp_api_token || '', version: organization.whatsapp_graph_api_version || 'v25.0',
    businessAccountId: organization.whatsapp_business_account_id || '', phoneNumberId: organization.whatsapp_phone_number_id || '' }
  if (!credentials.token || !credentials.businessAccountId || !credentials.phoneNumberId) throw new Error('Add the WhatsApp access token, Business Account ID and Phone Number ID in Settings')
  if (!/^v\d+\.\d+$/.test(credentials.version)) throw new Error('Invalid Graph API version in Settings')
  return credentials
}
export class MetaFlowError extends Error {
  constructor(message: string, public details: any[] = [], public status?: number) {
    super(message)
    this.name = 'MetaFlowError'
  }
}
export async function metaRequest(credentials: MetaCredentials, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<any> {
  const response = await fetcher(`https://graph.facebook.com/${credentials.version}/${path}`, {
    ...init, headers: { Authorization: `Bearer ${credentials.token}`, ...init.headers }, signal: AbortSignal.timeout(20000),
  })
  const data = await response.json().catch(() => ({})) // Meta's outage pages are not JSON
  if (!response.ok || data.error) throw new MetaFlowError(data.error?.error_user_msg || data.error?.message || `Meta returned HTTP ${response.status}`, data.error ? [data.error] : [], response.status)
  return data
}
/** True when Meta says the flow no longer exists, so a delete can treat it as already done. */
export function isMetaFlowGone(error: unknown): boolean {
  if (!(error instanceof MetaFlowError)) return false
  if (error.status === 404) return true
  const detail = error.details[0] || {}
  return Number(detail.code) === 100 && (Number(detail.error_subcode) === 33 || /does not exist/i.test(`${detail.message || ''} ${detail.error_user_msg || ''}`))
}
export async function uploadNativeFlow(credentials: MetaCredentials, flow: { name: string; categories: string[]; flow_id_meta?: string | null }, json: MetaFlowJSON,
  saveMetaId: (id: string) => Promise<void>, fetcher: typeof fetch = fetch) {
  let id = flow.flow_id_meta
  if (id) {
    const remote = await metaRequest(credentials, `${id}?fields=id,status`, {}, fetcher)
    if (remote.status !== 'DRAFT') throw new MetaFlowError('Published forms cannot be edited. Create a new form for a new version.')
    const metadata = new FormData()
    metadata.set('name', flow.name); metadata.set('categories', JSON.stringify(flow.categories))
    await metaRequest(credentials, id, { method: 'POST', body: metadata }, fetcher)
  } else {
    const body = new FormData()
    body.set('name', flow.name); body.set('categories', JSON.stringify(flow.categories))
    const created = await metaRequest(credentials, `${credentials.businessAccountId}/flows`, { method: 'POST', body }, fetcher)
    if (!created.id) throw new MetaFlowError('Meta did not return a Flow ID')
    id = String(created.id)
    await saveMetaId(id) // Persist immediately so validation retries update the same draft.
  }
  const body = new FormData()
  body.set('name', 'flow.json'); body.set('asset_type', 'FLOW_JSON')
  body.set('file', new Blob([JSON.stringify(json)], { type: 'application/json' }), 'flow.json')
  const uploaded = await metaRequest(credentials, `${id}/assets`, { method: 'POST', body }, fetcher)
  if (uploaded.validation_errors?.length) throw new MetaFlowError('Meta rejected the form. Correct the validation errors and try again.', uploaded.validation_errors)
  if (uploaded.success !== true) throw new MetaFlowError('Meta did not confirm the form upload')
  return id
}

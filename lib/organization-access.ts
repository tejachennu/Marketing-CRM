/**
 * What each role may read from and write to an `organizations` row.
 * Pure rules, shared by /api/organization and its tests.
 */

import { can, describeDenied, type Permission, type RoleSubject } from './rbac'

// Credentials never leave the server for someone who cannot manage settings
const SECRET_COLUMN = /(token|secret|password|api_key|private_key|account_sid)/i

export function isSecretColumn(column: string): boolean {
  return SECRET_COLUMN.test(column)
}

export interface OrganizationCredentials {
  /** A WhatsApp sender is connected, through Meta Cloud API or Twilio. */
  messaging: boolean
  email: boolean
  ai: boolean
}

function hasValue(value: unknown): boolean {
  return String(value ?? '').trim().length > 0
}

export function getOrganizationCredentials(organization: Record<string, any> | null | undefined): OrganizationCredentials {
  const metaConnected = hasValue(organization?.whatsapp_api_token) && hasValue(organization?.whatsapp_phone_number_id)
  const twilioConnected = hasValue(organization?.twilio_account_sid) && hasValue(organization?.twilio_auth_token)
  const smtpConfigured = hasValue(organization?.smtp_host) && hasValue(organization?.smtp_email) && hasValue(organization?.smtp_password)
  return {
    messaging: metaConnected || twilioConnected,
    email: hasValue(organization?.sendgrid_api_key) || smtpConfigured,
    ai: hasValue(organization?.openai_api_key),
  }
}

/**
 * The organization as any member may see it: every credential column removed, replaced by
 * yes/no answers about what is configured.
 */
export function toSafeOrganization(organization: Record<string, any>): Record<string, any> {
  const safe: Record<string, any> = {}
  for (const [column, value] of Object.entries(organization)) {
    if (!isSecretColumn(column)) safe[column] = value
  }
  safe.credentials = getOrganizationCredentials(organization)
  // Read by getCommerceSetup in place of the token columns
  safe.whatsapp_connected = hasValue(organization.whatsapp_api_token) && hasValue(organization.whatsapp_phone_number_id)
  return safe
}

const SETTINGS_FIELDS = [
  'enable_ai', 'enable_email', 'enable_messages', 'enable_phone_calls', 'enable_sms',
  'twilio_account_sid', 'twilio_auth_token', 'twilio_whatsapp_number',
  'sendgrid_api_key', 'sendgrid_from_email',
  'openai_api_key', 'chatbot_base_prompt',
  'email_provider', 'smtp_host', 'smtp_port', 'smtp_email', 'smtp_password',
  'whatsapp_provider', 'whatsapp_api_token', 'whatsapp_default_phone',
  'whatsapp_graph_api_version', 'whatsapp_phone_number_id', 'whatsapp_business_account_id',
  'currency', 'ticket_email_enabled', 'ticket_email_recipients',
]

const AUTOMATION_FIELDS = [
  'service_synonyms',
  'enable_commerce', 'meta_catalog_id',
  'commerce_payment_gateway', 'commerce_gateway_config_name', 'commerce_enable_cod',
  'commerce_default_shipping_fee', 'commerce_free_shipping_threshold', 'commerce_address_flow_id',
  // Exists after scripts/db-migration-v34-commerce.js; the store page only sends it when it does
  'commerce_express_fee',
  // Exists after supabase/migrations/20261018_commerce_ai_assistant.sql; sent only when it does
  'commerce_ai_assistant',
]

/** Which permission a member needs to change each column. Columns not listed cannot be changed here. */
export const ORGANIZATION_FIELD_PERMISSIONS: Record<string, Permission> = {
  ...Object.fromEntries(SETTINGS_FIELDS.map((field) => [field, 'settings.manage' as Permission])),
  ...Object.fromEntries(AUTOMATION_FIELDS.map((field) => [field, 'automation.manage' as Permission])),
}

export type OrganizationUpdatePlan =
  | { ok: true; values: Record<string, any> }
  | { ok: false; status: 400 | 403; error: string }

/**
 * Check a requested change against the caller's role.
 * The whole request is refused if any field is not allowed, so a save never applies partially.
 */
export function planOrganizationUpdate(user: RoleSubject, updates: unknown): OrganizationUpdatePlan {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return { ok: false, status: 400, error: 'Nothing to update.' }
  }

  const entries = Object.entries(updates as Record<string, any>).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return { ok: false, status: 400, error: 'Nothing to update.' }

  const unknown = entries.map(([field]) => field).filter((field) => !(field in ORGANIZATION_FIELD_PERMISSIONS))
  if (unknown.length > 0) {
    return { ok: false, status: 400, error: `These settings cannot be changed here: ${unknown.join(', ')}` }
  }

  for (const [field] of entries) {
    const permission = ORGANIZATION_FIELD_PERMISSIONS[field]
    if (!can(user, permission)) return { ok: false, status: 403, error: describeDenied(permission) }
  }

  return { ok: true, values: Object.fromEntries(entries) }
}

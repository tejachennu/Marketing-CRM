/**
 * What each role may read from and write to an `organizations` row.
 * Pure rules, shared by /api/organization and its tests.
 */

import { can, describeDenied, type Permission, type RoleSubject } from './rbac'
import { SUPPORTED_PAYMENT_GATEWAYS } from './commerce/commerce-utils'

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
  // Verifies the webhooks of a number connected through the workspace's own Meta app. Exists after
  // its migration; the settings page sends it only when it does, or when a value was typed
  'whatsapp_app_secret',
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
  // Exists after supabase/migrations/20261104_commerce_reminders.sql; the cron tick reads it
  'commerce_reminders_enabled',
  // Exists after supabase/migrations/20261104_commerce_status_template.sql: the approved template
  // that carries order updates once a plain message is no longer allowed
  'commerce_status_template',
]

/** Which permission a member needs to change each column. Columns not listed cannot be changed here. */
export const ORGANIZATION_FIELD_PERMISSIONS: Record<string, Permission> = {
  ...Object.fromEntries(SETTINGS_FIELDS.map((field) => [field, 'settings.manage' as Permission])),
  ...Object.fromEntries(AUTOMATION_FIELDS.map((field) => [field, 'automation.manage' as Permission])),
}

/** The most a store charges for shipping, in its currency. Anything above is a typo, not a fee. */
export const MAX_STORE_AMOUNT = 1_000_000

const AMOUNT_FIELDS: Record<string, string> = {
  commerce_default_shipping_fee: 'The shipping fee',
  commerce_free_shipping_threshold: 'The free shipping threshold',
  commerce_express_fee: 'The express delivery charge',
}

// ── The order-update template ────────────────────────────────────────────────
// Meta names a template by its name and language. Names are lowercase letters, digits and
// underscores (up to 512 characters); languages are codes such as "en", "en_US", "pt_BR" or "fil".

export const MAX_TEMPLATE_NAME_LENGTH = 512
const TEMPLATE_NAME = /^[a-z0-9_]+$/
const TEMPLATE_LANGUAGE = /^[a-z]{2,3}(_[A-Z]{2})?$/

export const STATUS_TEMPLATE_ERROR =
  'The order-update template needs its name on Meta (lowercase letters, digits and underscores, up to 512 characters) and its language code, such as en or en_US.'

export interface StatusTemplate {
  name: string
  language: string
}

/**
 * The order-update template as it is stored: `{ name, language }` or null for none. The language
 * is put in Meta's casing ("en_US") because the fallback input lets it be typed by hand.
 */
export function checkStatusTemplate(value: unknown): { ok: true; value: StatusTemplate | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: STATUS_TEMPLATE_ERROR }
  const name = String((value as any).name ?? '').trim()
  const [base = '', region] = String((value as any).language ?? '').trim().split('_')
  const language = region === undefined ? base.toLowerCase() : `${base.toLowerCase()}_${region.toUpperCase()}`
  if (!name || name.length > MAX_TEMPLATE_NAME_LENGTH || !TEMPLATE_NAME.test(name) || !TEMPLATE_LANGUAGE.test(language)) {
    return { ok: false, error: STATUS_TEMPLATE_ERROR }
  }
  return { ok: true, value: { name, language } }
}

/**
 * A setting's value as it is stored, or the sentence saying why it is refused. Amounts arrive as
 * numbers or numeric strings and are stored as numbers: the browser's own checks are not relied on.
 */
function checkValue(field: string, value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (field in AMOUNT_FIELDS) {
    const amount = typeof value === 'string' ? Number(value.trim() || NaN) : value
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > MAX_STORE_AMOUNT) {
      return { ok: false, error: `${AMOUNT_FIELDS[field]} must be a number between 0 and ${MAX_STORE_AMOUNT.toLocaleString('en-US')}.` }
    }
    return { ok: true, value: Math.round(amount * 100) / 100 }
  }
  if (field === 'currency') {
    const code = String(value ?? '').trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(code)) return { ok: false, error: 'The currency must be a 3-letter code such as INR or USD.' }
    return { ok: true, value: code }
  }
  if (field === 'commerce_payment_gateway') {
    const gateway = String(value ?? '').trim().toLowerCase()
    if (!(SUPPORTED_PAYMENT_GATEWAYS as readonly string[]).includes(gateway)) {
      return { ok: false, error: `The payment gateway must be one of ${SUPPORTED_PAYMENT_GATEWAYS.join(', ')}.` }
    }
    return { ok: true, value: gateway }
  }
  if (field === 'commerce_status_template') return checkStatusTemplate(value)
  return { ok: true, value }
}

/**
 * PostgREST's answer when a column from a migration that has not been applied yet is written:
 * Postgres's 42703 ("column does not exist") or the schema cache's PGRST204.
 */
export function isMissingColumnError(error: unknown): boolean {
  const code = String((error as any)?.code || '')
  const message = String((error as any)?.message || '')
  return code === '42703' || code === 'PGRST204' || /column .* does not exist|could not find the '.+' column/i.test(message)
}

export type OrganizationUpdatePlan =
  | { ok: true; values: Record<string, any> }
  | { ok: false; status: 400 | 403; error: string }

/**
 * Check a requested change against the caller's role and each value against what its setting
 * accepts. The whole request is refused if any field is not allowed, so a save never applies partially.
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

  const values: Record<string, any> = {}
  for (const [field, value] of entries) {
    const checked = checkValue(field, value)
    if (!checked.ok) return { ok: false, status: 400, error: checked.error }
    values[field] = checked.value
  }

  return { ok: true, values }
}

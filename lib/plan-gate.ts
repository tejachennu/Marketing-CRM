/**
 * What each plan may reach on the server (owner, 24 Nov 2026: "without Meta just for billing and invoice generate and
 * analytics we can 999 ... if they connected Meta our plans will come ... be secure"). Starter (₹999) is Front Desk
 * without the business's own WhatsApp: bookings, bills, GST invoices and reports. Everything that needs the business's
 * own WhatsApp (Meta) — the inbox, tickets, templates, campaigns, flows, Instagram, the AI that answers chats — and the
 * other connectors come with Growth and Pro. The pages already hide these; this makes the server refuse them too, for
 * every caller (website, app, or anyone calling the address directly).
 */
import type { ConnectorKey } from './connectors'
import { planAllows, upgradeMessage, type PlanFeature, type PlanLimits } from './plans'

/** Server addresses and the plan feature they belong to (most specific first) */
const FEATURE_PATHS: [string, PlanFeature][] = [
  ['/api/conversations', 'inbox'],
  ['/api/messages', 'inbox'],
  ['/api/instagram', 'inbox'],
  ['/api/whatsapp', 'inbox'],
  ['/api/commerce/catalog', 'inbox'],
  ['/api/commerce/meta-detect', 'inbox'],
  ['/api/commerce/send', 'inbox'],
  ['/api/tickets', 'tickets'],
  ['/api/whatsapp-templates', 'templates'],
  ['/api/templates', 'templates'],
  ['/api/campaigns', 'campaigns'],
  ['/api/flows', 'flows'],
  ['/api/knowledge', 'ai_replies'],
  ['/api/ai', 'ai_replies'],
  ['/api/ai-realtime', 'ai_replies'],
  ['/api/voice-workflows', 'ai_replies'],
  ['/api/settings/api-keys', 'api'],
]

/** Connector screens' server addresses */
const CONNECTOR_PATHS: [string, ConnectorKey][] = [
  ['/api/commerce', 'ecommerce'],
  ['/api/pipeline', 'pipeline'],
  ['/api/salon', 'salon'],
]

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)

/** Pure: the plan feature an address needs, if any */
export function featureForPath(path: string): PlanFeature | null {
  const clean = path.replace(/\/+$/, '')
  return FEATURE_PATHS.find(([prefix]) => under(clean, prefix))?.[1] ?? null
}

/** Pure: the connector an address belongs to, if any */
export function connectorForPath(path: string): ConnectorKey | null {
  const clean = path.replace(/\/+$/, '')
  return CONNECTOR_PATHS.find(([prefix]) => under(clean, prefix))?.[1] ?? null
}

const CONNECTOR_NAMES: Record<ConnectorKey, string> = { salon: 'Front Desk', ecommerce: 'E-commerce', pipeline: 'Sales Pipeline' }

/**
 * Pure: why the plan refuses this address, or null. Only refuses what the plan leaves out completely (Starter: no own
 * WhatsApp, Front Desk only); which one connector is in use on a paid plan stays the Connectors page's business.
 */
export function planRefusal(limits: PlanLimits, path: string): string | null {
  const feature = featureForPath(path)
  if (feature && !planAllows(limits, feature)) return upgradeMessage(feature)
  const connector = connectorForPath(path)
  if (connector && limits.connectorKeys.length && !limits.connectorKeys.includes(connector)) {
    return `Your plan includes ${limits.connectorKeys.map((k) => CONNECTOR_NAMES[k]).join(' and ')} only. Upgrade to Growth or Pro in Billing to use ${CONNECTOR_NAMES[connector]}.`
  }
  return null
}

/** WhatsApp sender settings: saving any of them (not clearing) connects a number, which needs Growth or Pro */
export const SENDER_FIELDS = ['whatsapp_api_token', 'whatsapp_phone_number_id', 'whatsapp_business_account_id', 'twilio_account_sid', 'twilio_auth_token', 'twilio_whatsapp_number'] as const

/** Pure: does this settings change connect a WhatsApp number? */
export function connectsWhatsApp(values: Record<string, unknown> | null | undefined): boolean {
  if (!values || typeof values !== 'object') return false
  return SENDER_FIELDS.some((field) => typeof values[field] === 'string' && String(values[field]).trim() !== '')
}

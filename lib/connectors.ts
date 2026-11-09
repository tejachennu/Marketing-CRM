/**
 * Use-case connectors: industry apps a workspace switches on from the Connectors page.
 * E-commerce uses organizations.enable_commerce and Sales Pipeline organizations.enable_pipeline
 * (both on unless switched off); the others are listed in organizations.enabled_connectors. Safe for the browser: no server imports.
 */

export type ConnectorKey = 'ecommerce' | 'salon' | 'pipeline'

/** Connectors that are on unless a workspace switches them off */
const ON_BY_DEFAULT: ConnectorKey[] = ['ecommerce', 'pipeline']

export interface ConnectorDefinition {
  key: ConnectorKey
  name: string
  tagline: string
  points: string[]
  href: string
  menuLabel: string
}

export const CONNECTORS: ConnectorDefinition[] = [
  {
    key: 'salon',
    name: 'Front Desk',
    tagline: 'Bookings, billing and reviews for any business that takes appointments: salons, clinics, studios, service centres.',
    points: [
      'Bookings and walk-in bills in a few taps',
      'Starter kits for salons, clinics, gyms and repair shops',
      'GST invoices sent on WhatsApp in one tap',
      'Bookings and reviews from WhatsApp',
    ],
    href: '/dashboard/front-desk',
    menuLabel: 'Front Desk',
  },
  {
    key: 'ecommerce',
    name: 'E-commerce',
    tagline: 'Sell from your WhatsApp catalog with cart, payments and orders.',
    points: [
      'Your product catalog inside WhatsApp',
      'UPI and card payments, or cash on delivery',
      'Orders and delivery updates in one place',
      'AI shopping assistant answers buyers',
    ],
    href: '/dashboard/commerce',
    menuLabel: 'Commerce',
  },
  {
    key: 'pipeline',
    name: 'Sales Pipeline',
    tagline: 'Track every deal from first message to won: stages, follow-ups and reports.',
    points: [
      'A board of deals by stage: drag to move',
      'Follow-ups due today and overdue, with WhatsApp in one tap',
      'Won, lost and win rate by salesperson and source',
      'Leads from WhatsApp chats, your website or the API',
    ],
    href: '/dashboard/leads',
    menuLabel: 'Sales Pipeline',
  },
]

export function connectorDefinition(key: string): ConnectorDefinition | null {
  return CONNECTORS.find((connector) => connector.key === key) || null
}

/** Whether a workspace has a connector switched on. */
export function isConnectorOn(organization: Record<string, any> | null | undefined, key: ConnectorKey): boolean {
  if (!organization) return false
  if (key === 'ecommerce') return organization.enable_commerce !== false
  if (key === 'pipeline') return organization.enable_pipeline !== false
  return Array.isArray(organization.enabled_connectors) && organization.enabled_connectors.includes(key)
}

/** The enabled_connectors list after switching one connector on or off (no duplicates, known keys only). */
export function withConnector(current: unknown, key: ConnectorKey, enabled: boolean): string[] {
  const known = new Set<string>(CONNECTORS.map((connector) => connector.key).filter((k) => !ON_BY_DEFAULT.includes(k)))
  const list = (Array.isArray(current) ? current : []).map(String).filter((k) => known.has(k))
  const set = new Set(list)
  if (enabled && known.has(key)) set.add(key)
  else set.delete(key)
  return [...set].sort()
}

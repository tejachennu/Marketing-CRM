/**
 * Use-case connectors: industry apps a workspace switches on from the Connectors page.
 * E-commerce uses organizations.enable_commerce (on unless switched off); the others are listed
 * in organizations.enabled_connectors. Safe for the browser: no server imports.
 */

export type ConnectorKey = 'ecommerce' | 'salon'

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
    name: 'Spa & Salon',
    tagline: 'A voice-first front counter: book, bill and send GST invoices by speaking.',
    points: [
      'Say "Book Priya for a haircut at 5" and it is booked',
      'Today\'s board: arrived, in service, done',
      'GST invoices sent on WhatsApp in one tap',
      'Works in English, Telugu, Hindi and a mix',
    ],
    href: '/dashboard/salon',
    menuLabel: 'Salon Counter',
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
]

export function connectorDefinition(key: string): ConnectorDefinition | null {
  return CONNECTORS.find((connector) => connector.key === key) || null
}

/** Whether a workspace has a connector switched on. */
export function isConnectorOn(organization: Record<string, any> | null | undefined, key: ConnectorKey): boolean {
  if (!organization) return false
  if (key === 'ecommerce') return organization.enable_commerce !== false
  return Array.isArray(organization.enabled_connectors) && organization.enabled_connectors.includes(key)
}

/** The enabled_connectors list after switching one connector on or off (no duplicates, known keys only). */
export function withConnector(current: unknown, key: ConnectorKey, enabled: boolean): string[] {
  const known = new Set<string>(CONNECTORS.map((connector) => connector.key).filter((k) => k !== 'ecommerce'))
  const list = (Array.isArray(current) ? current : []).map(String).filter((k) => known.has(k))
  const set = new Set(list)
  if (enabled) set.add(key)
  else set.delete(key)
  return [...set].sort()
}

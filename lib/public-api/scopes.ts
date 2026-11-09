/** What an API key may do. Pure, so Settings can show them. */

export const API_SCOPES = {
  'contacts:read': 'Read contacts',
  'contacts:write': 'Create and update contacts',
  'messages:send': 'Send WhatsApp messages',
  'templates:read': 'Read WhatsApp templates',
  'front_desk:read': 'Read Front Desk services, staff, times, appointments and invoices',
  'front_desk:write': 'Book appointments and create bills in Front Desk',
  'leads:read': 'Read deals and stages in the Sales Pipeline',
  'leads:write': 'Create, move and close deals in the Sales Pipeline',
} as const
export type ApiScope = keyof typeof API_SCOPES
export const ALL_SCOPES = Object.keys(API_SCOPES) as ApiScope[]

/** Requests per minute for one key. */
export const RATE_LIMIT_PER_MINUTE = 120

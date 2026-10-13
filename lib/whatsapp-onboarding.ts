/**
 * Rules for onboarding a business through Meta's Embedded Signup, kept apart from the route so
 * they can be tested. Follows "Onboarding business customers as a Tech Provider":
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
 */

import { createHmac } from 'node:crypto'

/** The PIN every number was registered with before per-number PINs. Still tried for those numbers. */
export const LEGACY_REGISTRATION_PIN = '123456'

/** Meta's error for "this number already has a different two-step verification PIN". */
export const PIN_MISMATCH_ERROR_CODE = 133005

/**
 * The 6-digit PIN a number is registered with, which becomes its two-step verification PIN.
 * Derived from a server secret, so each number gets its own and it can be worked out again
 * without being stored. Without the secret, the old shared PIN is used.
 */
export function getRegistrationPin(phoneNumberId: string, secret: string | undefined = process.env.WHATSAPP_PIN_SECRET): string {
  if (!secret) return LEGACY_REGISTRATION_PIN
  const digest = createHmac('sha256', secret).update(`whatsapp-registration-pin:${phoneNumberId}`).digest()
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0')
}

const isNumericId = (value: unknown): value is string => typeof value === 'string' && /^\d{5,25}$/.test(value)

export interface SignupSession {
  wabaId: string
  phoneNumberId: string
  /** The customer's business portfolio. */
  businessId: string
  /** Catalogs the customer chose to share during signup. */
  catalogIds: string[]
}

/** What Embedded Signup reported about the finished flow, with anything that is not a Meta ID dropped. */
export function parseSignupSession(raw: Record<string, any> | null | undefined): SignupSession {
  const id = (value: unknown) => {
    const text = String(value ?? '').trim()
    return isNumericId(text) ? text : ''
  }
  const catalogs = Array.isArray(raw?.catalogIds) ? raw.catalogIds : []
  return {
    wabaId: id(raw?.wabaId),
    phoneNumberId: id(raw?.phoneNumberId),
    businessId: id(raw?.businessId),
    catalogIds: catalogs.map(id).filter(Boolean).slice(0, 10),
  }
}

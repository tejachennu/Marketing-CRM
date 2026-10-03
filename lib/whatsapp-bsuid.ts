/**
 * Utilities for Meta WhatsApp Business-Scoped User IDs (BSUID) and Phone Number Privacy (PNP).
 *
 * Meta generates BSUIDs when users connect via:
 * - Click-to-WhatsApp Ads
 * - WhatsApp Usernames
 * - Phone Number Privacy enabled
 *
 * Format: Two-letter ISO country code followed by dot and digits (e.g. `CA.1076013191946045`).
 */

/** Check if an identifier is a Meta BSUID (e.g., CA.1076013191946045 or +CA.1076013191946045) */
export function isBsuid(identifier?: string | null): boolean {
  if (!identifier) return false
  const clean = String(identifier).replace(/^whatsapp:/i, '').replace(/^\+/, '').trim()
  return /^[A-Z]{2}\.\d+$/i.test(clean)
}

/** Standardize BSUID to canonical format: uppercase country code + dot + digits (no +, no whatsapp:) */
export function canonicalizeBsuid(identifier: string): string {
  return String(identifier).replace(/^whatsapp:/i, '').replace(/^\+/, '').trim().toUpperCase()
}

/** Parse BSUID into country code and identifier part */
export function parseBsuid(identifier: string): { countryCode: string; idPart: string; last4: string } {
  const clean = canonicalizeBsuid(identifier)
  const [countryCode = 'WA', idPart = ''] = clean.split('.')
  return {
    countryCode,
    idPart,
    last4: idPart.slice(-4),
  }
}

/** Format BSUID into a friendly human-readable display string */
export function formatBsuidLabel(identifier: string): string {
  const { countryCode, last4 } = parseBsuid(identifier)
  return `WhatsApp User (${countryCode}${last4 ? ` • ${last4}` : ''})`
}

/**
 * Format a contact's display name cleanly:
 * If user has set a real name (e.g., "John Doe"), returns that name.
 * If the name is missing or is a raw BSUID/phone number, returns friendly name or formatted number.
 */
export function formatContactDisplayName(contact?: {
  first_name?: string | null
  last_name?: string | null
  phone_number?: string | null
} | null): string {
  if (!contact) return 'Unknown Contact'

  const firstName = (contact.first_name || '').trim()
  const lastName = (contact.last_name || '').trim()
  const fullName = `${firstName} ${lastName}`.trim()

  // If first name is a raw BSUID (e.g., "+CA.1076013191946045" or "CA.1076013191946045")
  if (isBsuid(firstName)) {
    return formatBsuidLabel(firstName)
  }

  // If full name is populated and not a raw BSUID
  if (fullName && fullName !== 'Unknown' && !isBsuid(fullName)) {
    return fullName
  }

  // If phone_number is a BSUID
  if (contact.phone_number && isBsuid(contact.phone_number)) {
    return formatBsuidLabel(contact.phone_number)
  }

  return fullName || contact.phone_number || 'Unknown Contact'
}

/**
 * Get two-letter avatar initials for contact:
 * If it's a BSUID (e.g., CA.1076...), return the country code (e.g. "CA") instead of "+C" or digits.
 * If it's a person's name (e.g. "John Doe"), return "JD".
 */
export function getContactAvatarInitials(contact?: {
  first_name?: string | null
  last_name?: string | null
  phone_number?: string | null
} | string | null): string {
  if (!contact) return 'WA'

  if (typeof contact === 'string') {
    if (isBsuid(contact)) {
      return parseBsuid(contact).countryCode
    }
    const clean = contact.replace(/^[+]/, '').trim()
    return (clean.substring(0, 2) || 'WA').toUpperCase()
  }

  const firstName = (contact.first_name || '').trim()
  if (isBsuid(firstName)) {
    return parseBsuid(firstName).countryCode
  }

  if (contact.phone_number && isBsuid(contact.phone_number)) {
    return parseBsuid(contact.phone_number).countryCode
  }

  const fullName = formatContactDisplayName(contact)
  if (isBsuid(fullName)) {
    return parseBsuid(fullName).countryCode
  }

  // If formatted as "WhatsApp User (CA • 6045)"
  const match = fullName.match(/\(([A-Z]{2})/i)
  if (match) return match[1].toUpperCase()

  // If name contains multiple words
  const parts = fullName.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }

  return (fullName.replace(/^[+]/, '').substring(0, 2) || 'WA').toUpperCase()
}

/**
 * Clean recipient phone/ID for Meta WhatsApp Cloud API:
 * If BSUID, keep uppercase country code + dot + digits (e.g., "CA.1076013191946045").
 * If standard phone number, remove non-digits (e.g., "14165550123").
 */
export function cleanWhatsAppRecipient(phoneOrBsuid: string): string {
  if (!phoneOrBsuid) return ''
  const clean = phoneOrBsuid.replace(/^whatsapp:/i, '').replace(/^\+/, '').trim()
  if (isBsuid(clean)) {
    return canonicalizeBsuid(clean)
  }
  return clean.replace(/\D/g, '')
}

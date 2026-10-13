import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Escape a value for safe interpolation into HTML text or attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Make free-text search input safe to interpolate into a PostgREST `.or()` filter.
 * Commas and parentheses delimit filters there, so a search like "Smith, John" or
 * "(416) 555-1234" would otherwise be rejected as a malformed query.
 */
export function sanitizeSearchTerm(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/[,()%*\\"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

/**
 * True for an http(s) address on the public internet. Used before the server downloads a
 * URL supplied by a user, so it cannot be pointed at this machine or the private network.
 */
export function isPublicHttpUrl(value: unknown): boolean {
  let url: URL
  try {
    url = new URL(String(value ?? ''))
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  // IPv4 loopback, private, link-local (cloud metadata lives at 169.254.169.254) and unspecified ranges
  if (/^(127|10|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
  // IPv6 loopback, unique-local and link-local
  if (host === '::1' || host === '::' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return false
  return true
}

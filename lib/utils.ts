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

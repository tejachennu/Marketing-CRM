/**
 * The business logo on salon invoices. Logos are PNG, JPEG or WebP only (never SVG, which can carry
 * scripts), checked by their first bytes rather than trusting the browser, and stored in the public
 * media bucket. Only http(s) links are ever shown.
 */

export type LogoType = 'image/png' | 'image/jpeg' | 'image/webp'

/** The browser shrinks logos to 512px before uploading, so this is generous. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024
export const LOGO_BUCKET = 'media-attachments'

const EXTENSIONS: Record<LogoType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** What kind of image the bytes really are, from their signature. */
export function sniffImageType(bytes: Uint8Array): LogoType | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value)
  if (bytes.length >= 8 && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (bytes.length >= 3 && starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (bytes.length >= 12 && starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

/** Where a workspace's logo is stored in the bucket. A new name each time, so browsers never show an old logo. */
export function logoStoragePath(organizationId: string, type: LogoType, now = Date.now()): string {
  return `salon-logos/${organizationId.replace(/[^a-zA-Z0-9-]/g, '')}/${now}.${EXTENSIONS[type]}`
}

/** A logo link that is safe to put in an <img>: https, or http on this machine while developing. */
export function isSafeLogoUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 1000) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
  } catch {
    return false
  }
}

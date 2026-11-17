import { timingSafeEqual } from 'node:crypto'

/** True when a request carries the shop server's key (STORE_GATEWAY_KEY, 16+ characters). */
export function hasServerKey(given: string | null, key = process.env.STORE_GATEWAY_KEY || ''): boolean {
  if (key.length < 16 || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(key)
  return a.length === b.length && timingSafeEqual(a, b)
}

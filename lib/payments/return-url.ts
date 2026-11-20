/**
 * Where a customer comes back to after paying on Stripe's page: the page they paid from, on WAMA's address or on
 * the business's own domain, never anywhere else. Pure, no imports.
 */

const PATH = /^\/[A-Za-z0-9/_\-.]{0,200}$/

export function returnBase(input: { origin: string | null | undefined; appUrl: string; domain: string | null | undefined; path: unknown; fallback: string }): string {
  const app = input.appUrl.replace(/\/$/, '')
  const own = input.domain ? `https://${String(input.domain).toLowerCase()}` : null
  const origin = String(input.origin || '').replace(/\/$/, '').toLowerCase()
  const base = own && origin === own ? own : app
  const path = typeof input.path === 'string' && PATH.test(input.path) && !input.path.includes('//') ? input.path : input.fallback
  return `${base}${path === '/' ? '' : path}`
}

/** base + query, keeping Stripe's {CHECKOUT_SESSION_ID} placeholder as it is. */
export function withQuery(base: string, query: Record<string, string>): string {
  const parts = Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${v === '{CHECKOUT_SESSION_ID}' ? v : encodeURIComponent(v)}`)
  return `${base}${base.includes('?') ? '&' : '?'}${parts.join('&')}`
}

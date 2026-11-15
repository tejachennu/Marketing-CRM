/**
 * Which host names are WAMA's own (the dashboard, previews, local runs) and which may be a business's
 * store domain. No imports: the middleware uses it.
 */

/** Addresses that belong to WAMA itself: never a business's store, and never taken over by one. */
const OWN_SUFFIXES = ['magnetora.in', 'vercel.app', 'vercel.com', 'localhost']

/** The app's own host names (from NEXT_PUBLIC_APP_URL and STORE_APP_HOSTS), lower case. */
function ownHosts(): string[] {
  const hosts: string[] = []
  try {
    if (process.env.NEXT_PUBLIC_APP_URL) hosts.push(new URL(process.env.NEXT_PUBLIC_APP_URL).hostname.toLowerCase())
  } catch {}
  for (const h of String(process.env.STORE_APP_HOSTS || '').split(',')) if (h.trim()) hosts.push(h.trim().toLowerCase())
  return hosts
}

/** True for WAMA's own addresses (the dashboard, previews, local runs). */
export function isOwnHost(host: string): boolean {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
  if (!h || h === '127.0.0.1' || h === '0.0.0.0' || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith('[')) return true
  if (ownHosts().includes(h)) return true
  return OWN_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`))
}

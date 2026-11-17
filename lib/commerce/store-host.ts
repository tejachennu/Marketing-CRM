/**
 * Which host names are WAMA's own (the dashboard, previews, local runs) and which may be a business's
 * store domain. No imports: the middleware uses it.
 */

/** Addresses that belong to WAMA itself, with everything under them: never a business's store. */
const OWN_SUFFIXES = ['vercel.app', 'vercel.com', 'localhost']

/**
 * Magnetora's own domain: the names WAMA and Magnetora use are kept, and any other
 * <name>.magnetora.in may be given to a store (handy for trying a store on its own address).
 */
const MAGNETORA = 'magnetora.in'
const MAGNETORA_RESERVED = ['www', 'wamacrm', 'stores', 'store', 'app', 'api', 'admin', 'mail', 'email', 'smtp', 'crm', 'dashboard', 'staging', 'dev', 'test', 'preview', 'docs', 'status', 'cdn', 'static', 'assets', 'auth', 'login']

/** The app's own host names (from NEXT_PUBLIC_APP_URL and STORE_APP_HOSTS), lower case. */
function ownHosts(): string[] {
  const hosts: string[] = []
  try {
    if (process.env.NEXT_PUBLIC_APP_URL) hosts.push(new URL(process.env.NEXT_PUBLIC_APP_URL).hostname.toLowerCase())
  } catch {}
  for (const h of String(process.env.STORE_APP_HOSTS || '').split(',')) if (h.trim()) hosts.push(h.trim().toLowerCase())
  if (process.env.STORE_GATEWAY_HOST) hosts.push(process.env.STORE_GATEWAY_HOST.trim().toLowerCase())
  return hosts
}

/** True for WAMA's own addresses (the dashboard, previews, local runs). */
export function isOwnHost(host: string): boolean {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
  if (!h || h === '127.0.0.1' || h === '0.0.0.0' || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith('[')) return true
  if (ownHosts().includes(h)) return true
  if (h === MAGNETORA) return true
  if (h.endsWith(`.${MAGNETORA}`)) {
    const names = h.slice(0, -MAGNETORA.length - 1).split('.')
    // books.magnetora.in can be a store; www / wamacrm / stores… and anything deeper under them cannot
    return names.length !== 1 || MAGNETORA_RESERVED.includes(names[0])
  }
  return OWN_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`))
}

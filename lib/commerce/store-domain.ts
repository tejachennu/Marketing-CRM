/**
 * A business's own web address for its online store (like Shopify): "shop.theirname.com" opens the same
 * store as wamacrm.magnetora.in/s/<slug>.
 *
 * It runs through WAMA's own store server (a Hostinger Ubuntu server with Caddy, see deploy/gateway/):
 * - the business points its domain at the server (CNAME to STORE_GATEWAY_HOST, or A to STORE_GATEWAY_IP);
 * - on the first visit Caddy asks /api/public/store-domain-check and, only for a connected domain, makes the
 *   https certificate by itself;
 * - Caddy passes the visit to the app with X-Store-Domain + X-Gateway-Key, and the middleware shows the store.
 * No limit on domains, and nothing is registered anywhere per domain. Until STORE_GATEWAY_HOST and
 * STORE_GATEWAY_IP are set, the option says it is not set up yet.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'

/** supabase/migrations/20261120_store_domain.sql word for word. */
export const STORE_DOMAIN_SQL = `-- The business's own web address for its online store (e.g. shop.theirname.com). Safe to run more than once.
-- The app runs it on its own when first needed.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS store_domain TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_store_domain_key ON organizations (store_domain) WHERE store_domain IS NOT NULL;

NOTIFY pgrst, 'reload schema';
`

export const STORE_DOMAIN_LOCK = 724519017
export const storeDomainSchemaSetup = createAutoSetup('Store domain', (connectionString) => runMigrationSql(connectionString, STORE_DOMAIN_SQL, STORE_DOMAIN_LOCK))

/** Run a database step; if the store_domain column is missing, add it and try again. */
export async function withStoreDomainSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = storeDomainSchemaSetup): Promise<any> {
  const first = await step()
  if (!isMissingSchemaError(first.error, /store_domain/)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && isMissingSchemaError(result.error, /store_domain/); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

export { isOwnHost } from './store-host'
import { isOwnHost } from './store-host'

/** Two-part endings where the "root" domain has three parts (theirname.co.in). */
const TWO_PART_ENDINGS = new Set(['co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in', 'co.uk', 'org.uk', 'com.au', 'net.au', 'co.nz', 'com.sg', 'com.my', 'co.za', 'com.br', 'ac.in', 'edu.in', 'gov.in'])

/**
 * A typed domain made clean ("https://Shop.MyName.com/" → "shop.myname.com"), or an error in plain words.
 */
export function cleanDomain(raw: unknown): { domain: string } | { error: string } {
  let value = String(raw ?? '').trim().toLowerCase()
  value = value.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '')
  if (!value) return { error: 'Type your domain, like shop.yourname.com.' }
  if (value.length > 253 || !value.includes('.')) return { error: 'That does not look like a domain. Type it like shop.yourname.com.' }
  const labels = value.split('.')
  if (labels.some((l) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) || !/^[a-z]{2,24}$/.test(labels[labels.length - 1])) {
    return { error: 'That does not look like a domain. Use letters, numbers and dashes, like shop.yourname.com.' }
  }
  if (isOwnHost(value)) return { error: 'That address belongs to WAMA. Use a domain you own.' }
  return { domain: value }
}

/** True when the domain is a root domain (theirname.com), which needs an A record instead of a CNAME. */
export function isRootDomain(domain: string): boolean {
  const labels = domain.split('.')
  if (labels.length <= 2) return true
  return labels.length === 3 && TWO_PART_ENDINGS.has(labels.slice(1).join('.'))
}

export interface DnsRecord {
  type: 'A' | 'CNAME'
  /** The "Name" / "Host" box at the domain seller. */
  name: string
  value: string
}

/** The host box for a record: "@" for the root, else the part before the root domain ("shop"). */
export function hostLabel(domain: string, recordDomain = domain): string {
  const labels = domain.split('.')
  const rootParts = labels.length >= 3 && TWO_PART_ENDINGS.has(labels.slice(-2).join('.')) ? 3 : 2
  const root = labels.slice(-rootParts).join('.')
  if (recordDomain === root) return '@'
  return recordDomain.endsWith(`.${root}`) ? recordDomain.slice(0, -(root.length + 1)) : recordDomain
}

export type DomainState = 'connected' | 'waiting' | 'unavailable'

export interface DomainStatus {
  domain: string | null
  state: DomainState | null
  records: DnsRecord[]
  /** Plain words on what is left to do. */
  note: string
}

/**
 * The store server (Hostinger Ubuntu + Caddy, deploy/gateway/). STORE_GATEWAY_HOST is its name
 * (e.g. stores.magnetora.in, the CNAME target), STORE_GATEWAY_IP its address (the A record for root
 * domains). Null until both are set.
 */
export function gatewayConfig(env: Record<string, string | undefined> = process.env) {
  const host = String(env.STORE_GATEWAY_HOST || '').trim().toLowerCase().replace(/\.$/, '')
  const ip = String(env.STORE_GATEWAY_IP || '').trim()
  if (!host || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return null
  return { host, ip }
}

/** True when businesses can connect their own domain (the store server is set up). */
export function domainsAvailable(): boolean {
  return Boolean(gatewayConfig())
}

export const NOT_SET_UP = 'Custom domains are not set up on WAMA yet. Please ask WAMA support.'

/** The one record the business adds at its domain company. */
export function dnsRecordsFor(domain: string, gateway: { host: string; ip: string }): DnsRecord[] {
  // A main domain also gets www (it opens the store at the main domain)
  return isRootDomain(domain)
    ? [{ type: 'A', name: '@', value: gateway.ip }, { type: 'CNAME', name: 'www', value: domain }]
    : [{ type: 'CNAME', name: hostLabel(domain), value: gateway.host }]
}

export interface DnsLookup {
  cname: (name: string) => Promise<string[]>
  a: (name: string) => Promise<string[]>
  /** IPv6 addresses (optional: older callers and tests leave it out) */
  aaaa?: (name: string) => Promise<string[]>
}

const realDns: DnsLookup = {
  cname: async (name) => {
    const { promises } = await import('node:dns')
    return promises.resolveCname(name).catch(() => [])
  },
  a: async (name) => {
    const { promises } = await import('node:dns')
    return promises.resolve4(name).catch(() => [])
  },
  aaaa: async (name) => {
    const { promises } = await import('node:dns')
    return promises.resolve6(name).catch(() => [])
  },
}

/** The store server's own IPv6 address, if it has one people may point to (STORE_GATEWAY_IP6, optional). */
function gatewayIp6(env: Record<string, string | undefined> = process.env): string {
  return String(env.STORE_GATEWAY_IP6 || '').trim().toLowerCase()
}

export const IPV6_NOTE = 'Your domain also has an IPv6 (AAAA) record that points somewhere else. Delete the AAAA record at the company where you bought the domain; then your store connects by itself within a few minutes.'

/** Where the domain stands: connected once its DNS points at the store server, else the record to add. */
/** Does the domain really open the store over https? (Asks the store's own domain check through it.) */
async function opensOverHttps(domain: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${domain}/api/public/store-domain-check?domain=${encodeURIComponent(domain)}`, { signal: AbortSignal.timeout(6000), cache: 'no-store' })
    return res.status === 200
  } catch {
    return false
  }
}

export async function domainStatus(domain: string | null, lookup: DnsLookup = realDns, opens: (domain: string) => Promise<boolean> = opensOverHttps): Promise<DomainStatus> {
  if (!domain) return { domain: null, state: null, records: [], note: '' }
  const gateway = gatewayConfig()
  if (!gateway) return { domain, state: 'unavailable', records: [], note: NOT_SET_UP }
  const records = dnsRecordsFor(domain, gateway)
  const [cnames, addresses] = await Promise.all([lookup.cname(domain), lookup.a(domain)])
  const pointsHere = cnames.some((c) => c.toLowerCase().replace(/\.$/, '') === gateway.host) || addresses.includes(gateway.ip)
  if (pointsHere) {
    // Connected only once the address really opens the store with https
    if (await opens(domain)) return { domain, state: 'connected', records, note: 'Your store opens on this address.' }
    // A leftover IPv6 record (domain companies often add one) sends the certificate check elsewhere: it never connects
    const v6 = lookup.aaaa ? await lookup.aaaa(domain) : []
    const ip6 = gatewayIp6()
    if (v6.some((ip) => ip.toLowerCase() !== ip6)) return { domain, state: 'waiting', records, note: IPV6_NOTE }
    return { domain, state: 'waiting', records, note: 'Your domain points to us. WAMA is now turning on the secure (https) link for it; this usually takes a few minutes. Tap Check again soon.' }
  }
  return {
    domain,
    state: 'waiting',
    records,
    note: addresses.length || cnames.length
      ? 'Your domain still points somewhere else. Change the record below at the company where you bought the domain (GoDaddy, Hostinger, …). Using Cloudflare? Set the record to "DNS only" (grey cloud).'
      : 'Add the record below at the company where you bought the domain (GoDaddy, Hostinger, …). It can take from a few minutes up to a day to work.',
  }
}

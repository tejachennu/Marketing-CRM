/**
 * A business's own web address for its online store (like Shopify): "shop.theirname.com" opens the same
 * store as wamacrm.magnetora.in/s/<slug>. The domain is added to our Vercel project through Vercel's API
 * (Vercel makes the https certificate), the business adds one DNS record at its domain seller, and the
 * middleware sends visits on that address to the store page.
 *
 * Needs VERCEL_TOKEN and VERCEL_PROJECT_ID (and VERCEL_TEAM_ID when the project belongs to a team) in the
 * server's environment. Without them the option says it is not available yet.
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
  type: 'A' | 'CNAME' | 'TXT'
  /** The "Name" / "Host" box at the domain seller. */
  name: string
  value: string
}

export const VERCEL_IP = '76.76.21.21'
export const VERCEL_CNAME = 'cname.vercel-dns.com'

/** The host box for a record: "@" for the root, else the part before the root domain ("shop"). */
export function hostLabel(domain: string, recordDomain = domain): string {
  const labels = domain.split('.')
  const rootParts = labels.length >= 3 && TWO_PART_ENDINGS.has(labels.slice(-2).join('.')) ? 3 : 2
  const root = labels.slice(-rootParts).join('.')
  if (recordDomain === root) return '@'
  return recordDomain.endsWith(`.${root}`) ? recordDomain.slice(0, -(root.length + 1)) : recordDomain
}

/** The record(s) the business adds at its domain seller. */
export function dnsRecordsFor(domain: string, verification: { type?: string; domain?: string; value?: string }[] = [], recommended?: { ipv4?: string; cname?: string }): DnsRecord[] {
  const records: DnsRecord[] = isRootDomain(domain)
    ? [{ type: 'A', name: '@', value: recommended?.ipv4 || VERCEL_IP }]
    : [{ type: 'CNAME', name: hostLabel(domain), value: recommended?.cname || VERCEL_CNAME }]
  for (const v of verification) {
    if (String(v.type).toUpperCase() === 'TXT' && v.domain && v.value) records.push({ type: 'TXT', name: hostLabel(domain, v.domain), value: v.value })
  }
  return records
}

export type DomainState = 'connected' | 'waiting' | 'unavailable'

export interface DomainStatus {
  domain: string | null
  state: DomainState | null
  records: DnsRecord[]
  /** Plain words on what is left to do. */
  note: string
}

/** Vercel settings from the environment, or null when custom domains are not set up. */
export function vercelConfig(env: Record<string, string | undefined> = process.env) {
  const token = String(env.VERCEL_TOKEN || env.VERCEL_API_TOKEN || '').trim()
  const projectId = String(env.VERCEL_PROJECT_ID || '').trim()
  if (!token || !projectId) return null
  const teamId = String(env.VERCEL_TEAM_ID || '').trim()
  return { token, projectId, teamId }
}

type Fetch = typeof fetch

async function vercel(config: NonNullable<ReturnType<typeof vercelConfig>>, method: string, path: string, body?: unknown, fetcher: Fetch = fetch) {
  const url = new URL(`https://api.vercel.com${path}`)
  if (config.teamId) url.searchParams.set('teamId', config.teamId)
  const res = await fetcher(url.toString(), {
    method,
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  const data: any = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

/** Vercel's error in plain words for the business. */
export function vercelProblem(status: number, data: any): string {
  const code = String(data?.error?.code || '')
  if (code === 'domain_already_in_use' || code === 'domain_taken' || status === 409) {
    return 'This domain is already connected to another website. Remove it there first, or use another address like shop.yourname.com.'
  }
  if (code === 'invalid_domain' || code === 'invalid_name') return 'That domain is not valid. Type it like shop.yourname.com.'
  if (code === 'forbidden' || status === 401 || status === 403) return 'Custom domains are not set up on WAMA right now. Please ask WAMA support.'
  if (status === 429) return 'Too many tries. Please try again in a few minutes.'
  return 'The domain could not be connected right now. Please try again.'
}

/** Add the domain to our Vercel project (already added = fine). */
export async function addDomain(domain: string, fetcher: Fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = vercelConfig()
  if (!config) return { ok: false, error: 'Custom domains are not set up on WAMA yet. Please ask WAMA support.' }
  const res = await vercel(config, 'POST', `/v10/projects/${encodeURIComponent(config.projectId)}/domains`, { name: domain }, fetcher)
  if (res.ok) return { ok: true }
  // Already on this project (e.g. a second try) is not a problem
  if (res.status === 409 && /already.*(this|your) project|domain_already_exists/i.test(`${res.data?.error?.code} ${res.data?.error?.message}`)) return { ok: true }
  return { ok: false, error: vercelProblem(res.status, res.data) }
}

/** Take the domain off our Vercel project (gone already = fine). */
export async function removeDomain(domain: string, fetcher: Fetch = fetch): Promise<boolean> {
  const config = vercelConfig()
  if (!config) return true
  const res = await vercel(config, 'DELETE', `/v9/projects/${encodeURIComponent(config.projectId)}/domains/${encodeURIComponent(domain)}`, undefined, fetcher)
  return res.ok || res.status === 404
}

/** Where the domain stands: connected (https works), or the records still to add. */
export async function domainStatus(domain: string | null, fetcher: Fetch = fetch): Promise<DomainStatus> {
  if (!domain) return { domain: null, state: null, records: [], note: '' }
  const config = vercelConfig()
  if (!config) return { domain, state: 'unavailable', records: dnsRecordsFor(domain), note: 'Custom domains are not set up on WAMA yet. Please ask WAMA support.' }
  const base = `/v9/projects/${encodeURIComponent(config.projectId)}/domains/${encodeURIComponent(domain)}`
  let project = await vercel(config, 'GET', base, undefined, fetcher).catch(() => null)
  if (project && project.status === 404) {
    // Saved here but not on Vercel (e.g. removed there): add it again
    await addDomain(domain, fetcher).catch(() => null)
    project = await vercel(config, 'GET', base, undefined, fetcher).catch(() => null)
  }
  if (project?.ok && project.data?.verified === false) {
    const verify = await vercel(config, 'POST', `${base}/verify`, undefined, fetcher).catch(() => null)
    if (verify?.ok) project = verify
  }
  const dns = await vercel(config, 'GET', `/v6/domains/${encodeURIComponent(domain)}/config`, undefined, fetcher).catch(() => null)
  const verification = Array.isArray(project?.data?.verification) ? project!.data.verification : []
  const recommended = {
    ipv4: Array.isArray(dns?.data?.recommendedIPv4) ? dns!.data.recommendedIPv4.find((r: any) => r?.rank === 1)?.value?.[0] : undefined,
    cname: Array.isArray(dns?.data?.recommendedCNAME) ? String(dns!.data.recommendedCNAME.find((r: any) => r?.rank === 1)?.value || '').replace(/\.$/, '') || undefined : undefined,
  }
  const records = dnsRecordsFor(domain, verification, recommended)
  const verified = project?.ok ? project.data?.verified !== false : false
  const configured = dns?.ok ? dns.data?.misconfigured === false : false
  if (verified && configured) return { domain, state: 'connected', records, note: 'Your store opens on this address.' }
  if (!project?.ok) return { domain, state: 'waiting', records, note: 'We could not check your domain just now. Try again in a minute.' }
  return {
    domain,
    state: 'waiting',
    records,
    note: verified
      ? 'Add the record below at the company where you bought the domain (GoDaddy, Hostinger, …). It can take from a few minutes up to a day to work.'
      : 'This domain is used on another website account. Add the TXT record below too, so we know it is yours.',
  }
}

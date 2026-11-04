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

// ── Addresses the server may download from ──────────────────────────────────
// Used before the server fetches a URL supplied by a user (media to forward to WhatsApp), so the
// fetch cannot be pointed at this machine, the cloud metadata service or the private network.

/** The four octets of a dotted-quad IPv4 address, or null. */
function ipv4Octets(address: string): number[] | null {
  const match = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return null
  const octets = match.slice(1).map(Number)
  return octets.every((octet) => octet <= 255) ? octets : null
}

function isPrivateIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // 0.0.0.0/8: "this network", and 0.0.0.0 itself reaches this machine
    a === 10 || // private
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 carrier-grade NAT, used inside cloud networks too
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local; cloud metadata lives at 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12 private
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // 192.0.0/24 IETF assignments, 192.0.2/24 documentation
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // 198.18/15 benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) || // documentation
    a >= 224 // 224/4 multicast, 240/4 reserved, 255.255.255.255 broadcast
  )
}

/** The eight 16-bit groups of an IPv6 address (an embedded IPv4 tail included), or null. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase().split('%')[0] // drop a zone id such as "%eth0"
  const embedded = text.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (embedded) {
    const octets = ipv4Octets(embedded[2])
    if (!octets) return null
    text = `${embedded[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const groups = halves.length === 2 ? [...head, ...new Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head
  if (groups.length !== 8 || !groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null
  return groups.map((group) => parseInt(group, 16))
}

function isPrivateIpv6([g0, g1, g2, g3, g4, g5, g6, g7]: number[]): boolean {
  // Two groups read as an IPv4 address, for the forms that wrap one; most keep it in the last two
  const ipv4In = (high: number, low: number) => isPrivateIpv4([high >> 8, high & 255, low >> 8, low & 255])
  const wrappedIpv4 = () => ipv4In(g6, g7)
  const zeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0
  if (zeroPrefix && g5 === 0xffff) return wrappedIpv4() // ::ffff:a.b.c.d, IPv4-mapped: connects to the IPv4 address
  if (zeroPrefix && g5 === 0) {
    if (g6 === 0 && g7 <= 1) return true // :: unspecified, ::1 loopback
    return wrappedIpv4() // ::a.b.c.d, IPv4-compatible
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return wrappedIpv4() // 64:ff9b::/96 NAT64
  // 64:ff9b:1::/48 (RFC 8215) is NAT64 again, through a translator on the local network instead
  // of the well-known prefix; it connects to the IPv4 address in the last 32 bits just the same
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return wrappedIpv4()
  // 2002::/16 6to4: tunnelled to the IPv4 address in groups 1-2, so 2002:7f00:1:: reaches 127.0.0.1
  if (g0 === 0x2002) return ipv4In(g1, g2)
  return (
    (g0 & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (g0 & 0xffc0) === 0xfec0 || // fec0::/10 site-local (deprecated, still routed on some networks)
    (g0 & 0xfe00) === 0xfc00 || // fc00::/7 unique-local
    (g0 & 0xff00) === 0xff00 || // ff00::/8 multicast
    (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) || // 100::/64 discard
    (g0 === 0x2001 && g1 === 0xdb8) // 2001:db8::/32 documentation
  )
}

/**
 * True for an IP address that is not on the public internet: loopback, private, link-local,
 * carrier-grade NAT, multicast and reserved ranges, and the IPv6 forms that wrap an IPv4 address.
 * Anything that does not parse as an address counts as private, so a parser disagreement fails closed.
 */
export function isPrivateIpAddress(address: unknown): boolean {
  const text = String(address ?? '').trim().replace(/^\[|\]$/g, '')
  const octets = ipv4Octets(text)
  if (octets) return isPrivateIpv4(octets)
  const groups = ipv6Groups(text)
  return groups ? isPrivateIpv6(groups) : true
}

/** True when `host` is written as an IP address rather than a name. */
function isIpLiteral(host: string): boolean {
  return host.includes(':') || ipv4Octets(host) !== null
}

/**
 * The hostname of an http(s) URL, unless the URL or its name already gives away that it points
 * at this machine or the local network; then null. The URL parser has normalised numeric hosts
 * ("2130706433", "0x7f.1") to dotted quads by the time they are checked here.
 */
function publicHttpHost(value: unknown): string | null {
  let url: URL
  try {
    url = new URL(String(value ?? ''))
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null
  if (isIpLiteral(host)) return isPrivateIpAddress(host) ? null : host
  // A name without a dot ("intranet", "db") is looked up on the local network, never on the internet
  if (!host.includes('.')) return null
  return host
}

/**
 * True for an http(s) address on the public internet, judged from the address alone. Names are
 * not resolved here, so a name that points at a private address still passes; call
 * `assertPublicHttpUrl` before the server downloads anything.
 */
export function isPublicHttpUrl(value: unknown): boolean {
  return publicHttpHost(value) !== null
}

/**
 * This file is bundled for the browser as well (for `cn`), so the DNS module is taken from the
 * Node runtime instead of imported: bundlers leave `process.getBuiltinModule` alone.
 */
function nodeDns(): typeof import('node:dns') | null {
  return typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function' ? process.getBuiltinModule('node:dns') : null
}

/**
 * Check an http(s) URL supplied by a user, resolving its name, and refuse it unless every
 * address it resolves to is on the public internet. `isPublicHttpUrl` only reads the hostname;
 * this also catches names such as `127-0-0-1.nip.io` or an internal DNS entry that point at this
 * machine or the private network. Rejects by throwing an Error whose message is safe to show.
 */
export async function assertPublicHttpUrl(value: unknown): Promise<URL> {
  const host = publicHttpHost(value)
  if (!host) throw new Error('Only a public http(s) address can be downloaded')
  const url = new URL(String(value))
  if (isIpLiteral(host)) return url // already judged by publicHttpHost

  const dns = nodeDns()
  if (!dns) throw new Error('Cannot check where this address points: DNS is not available here')
  let addresses: { address: string }[]
  try {
    addresses = await dns.promises.lookup(host, { all: true })
  } catch {
    throw new Error(`Could not resolve ${host}`)
  }
  if (addresses.length === 0) throw new Error(`Could not resolve ${host}`)
  // One private answer is enough to refuse: the fetch would use whichever address it gets
  if (addresses.some(({ address }) => isPrivateIpAddress(address))) {
    throw new Error(`${host} points at a private network address`)
  }
  return url
}

// ── Downloading what a user pointed at ───────────────────────────────────────
// `assertPublicHttpUrl` resolves the name once; a plain `fetch` would then resolve it again when it
// connects, and a name with a zero TTL can answer "public" to the first lookup and "private" to the
// second. The download below checks the address in the lookup the socket itself uses, so the
// address that was checked is the address connected to. The name is never replaced by the address,
// so TLS still verifies the certificate for the name (SNI) and the Host header stays the name.

/**
 * A `lookup` for `http(s).request` (and `net.connect`) that refuses to connect when any address
 * the name resolves to is off the public internet. IP literals never reach a lookup, so callers
 * still check the URL itself with `assertPublicHttpUrl` on every hop.
 */
export const lookupPublicAddress: import('node:net').LookupFunction = (hostname, options, callback) => {
  // On an error the socket reads no address; '' only satisfies the callback's type
  const refuse = (error: NodeJS.ErrnoException) => callback(error, '')
  const dns = nodeDns()
  if (!dns) return refuse(new Error('Cannot check where this address points: DNS is not available here'))
  const lookupOptions = { ...(options || {}), all: true } as import('node:dns').LookupAllOptions
  dns.lookup(hostname, lookupOptions, (error, addresses) => {
    if (error) return refuse(error)
    if (!addresses || addresses.length === 0) return refuse(Object.assign(new Error(`Could not resolve ${hostname}`), { code: 'ENOTFOUND' }))
    // One private answer is enough to refuse: the socket would use whichever address it gets
    if (addresses.some(({ address }) => isPrivateIpAddress(address))) {
      return refuse(Object.assign(new Error(`${hostname} points at a private network address`), { code: 'EPRIVATEADDRESS' }))
    }
    if (options?.all) return callback(null, addresses)
    callback(null, addresses[0].address, addresses[0].family)
  })
}

export interface PublicDownloadLimits {
  maxBytes: number
  maxRedirects: number
  /** For the whole download: every hop and the body together. */
  timeoutMs: number
  /**
   * The first address is this app's own (a path on it, joined to its configured base URL), so it
   * is neither checked nor pinned. Every redirect from it still is.
   */
  trustFirstHop?: boolean
}

export interface PublicDownload {
  buffer: Buffer
  contentType: string | null
  /** The address the body came from, after redirects. */
  url: string
}

type NodeIncoming = import('node:http').IncomingMessage

/** One GET, connected only to an address `lookupPublicAddress` accepted unless `trusted`. */
function openHttp(url: URL, trusted: boolean, signal: AbortSignal): Promise<NodeIncoming> {
  const builtin = typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function' ? process.getBuiltinModule : null
  const client = builtin ? (url.protocol === 'https:' ? builtin('node:https') : builtin('node:http')) : null
  if (!client) return Promise.reject(new Error('Downloads are not available here'))
  return new Promise((resolve, reject) => {
    const request = client.request(url, {
      method: 'GET',
      signal,
      // A connection of its own: a pooled socket may have been opened without the check
      agent: false,
      // fetch() sent these; some media hosts refuse a request without a User-Agent. No
      // Accept-Encoding: node:http does not decompress, so the body must arrive as stored
      headers: { 'user-agent': 'WAMA-CRM media fetch', accept: '*/*' },
      ...(trusted ? {} : { lookup: lookupPublicAddress }),
    }, resolve)
    request.on('error', reject)
    request.end()
  })
}

/** The body of a response, refused before it is held in memory once it is known to exceed `maxBytes`. */
function readBodyUpTo(res: NodeIncoming, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  const tooLarge = () => new Error(`Media is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`)
  if (Number(res.headers['content-length']) > maxBytes) {
    res.destroy()
    return Promise.reject(tooLarge())
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const finish = (error: Error | null) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      if (error) {
        res.destroy()
        reject(error)
      } else {
        resolve(Buffer.concat(chunks))
      }
    }
    // The time limit covers the body too: a server trickling bytes is cut off
    const onAbort = () => finish(new Error('The download took too long'))
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort)
    res.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) return finish(tooLarge())
      chunks.push(chunk)
    })
    res.on('end', () => finish(null))
    res.on('error', (error) => finish(error))
    res.on('close', () => finish(new Error('The download was cut off')))
  })
}

/**
 * Download an http(s) URL supplied by a user, without ever connecting to this machine or the
 * private network: each hop is checked with `assertPublicHttpUrl` (a friendly refusal, and the
 * only check an IP literal gets) and then connected through `lookupPublicAddress`. Redirects are
 * followed by hand, at most `maxRedirects` of them. Rejects with an Error on any refusal, a
 * non-2xx answer, a body over `maxBytes`, or the time limit.
 */
export async function downloadPublicHttpUrl(value: string, limits: PublicDownloadLimits): Promise<PublicDownload> {
  const signal = AbortSignal.timeout(limits.timeoutMs)
  let current = value
  for (let hop = 0; ; hop++) {
    const trusted = hop === 0 && limits.trustFirstHop === true
    const url = trusted ? new URL(current) : await assertPublicHttpUrl(current)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only an http(s) address can be downloaded')
    const res = await openHttp(url, trusted, signal)
    const status = res.statusCode || 0
    const location = res.headers.location
    if (status >= 300 && status < 400 && location) {
      res.destroy()
      if (hop >= limits.maxRedirects) throw new Error(`The address redirects more than ${limits.maxRedirects} times`)
      current = new URL(location, url).toString()
      continue
    }
    if (status < 200 || status >= 300) {
      res.destroy()
      throw new Error(`Failed to download: ${status} ${res.statusMessage || ''}`.trim())
    }
    const buffer = await readBodyUpTo(res, limits.maxBytes, signal)
    const contentType = res.headers['content-type']
    return { buffer, contentType: typeof contentType === 'string' ? contentType : null, url: url.toString() }
  }
}

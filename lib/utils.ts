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

/**
 * Pictures made for a business's online store page when it has none of its own yet: banner
 * backgrounds, a round logo with the business's initials, and category tiles. Plain shapes in the
 * store's one colour (no gradients), drawn as SVG, so nothing is stored and they always look sharp.
 *
 * Served by GET /api/public/store-art?kind=banner|logo|tile&…; the page lays the banner's words on top.
 */

import { STORE_COLOURS } from './storefront'

export type ArtKind = 'banner' | 'logo' | 'tile'

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/** The store colour, or the first preset when the value is not a plain #RRGGBB. */
export function artColour(value: unknown): string {
  const colour = String(value ?? '').trim().toUpperCase()
  const full = colour.startsWith('#') ? colour : `#${colour}`
  return /^#[0-9A-F]{6}$/.test(full) ? full : STORE_COLOURS[0]
}

/** Up to two letters for a name: "Magnetora AI" → "MA", "csat37" → "C". */
export function initials(name: string): string {
  const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  if (!words.length) return 'S'
  const letters = words.length === 1 ? words[0].slice(0, 1) : words[0].slice(0, 1) + words[1].slice(0, 1)
  return letters.toUpperCase()
}

/** The colour mixed with white (amount 0–1): flat tints, never a gradient. */
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * amount)
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`
}

/** The colour mixed with black (amount 0–1). */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c * (1 - amount))
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`
}

const FONT = `font-family="Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"`

/** A simple shopping bag drawn from shapes, centred on (x, y), size s. */
function bag(x: number, y: number, s: number, fill: string, stroke: string) {
  const w = s, h = s * 0.9
  return `<g transform="translate(${x - w / 2} ${y - h / 2})">
  <path d="M${w * 0.32} ${h * 0.28} V${h * 0.2} a${w * 0.18} ${w * 0.18} 0 0 1 ${w * 0.36} 0 V${h * 0.28}" fill="none" stroke="${stroke}" stroke-width="${s * 0.05}" stroke-linecap="round"/>
  <rect x="${w * 0.1}" y="${h * 0.28}" width="${w * 0.8}" height="${h * 0.72}" rx="${s * 0.08}" fill="${fill}"/>
  </g>`
}

/**
 * A banner background, 1600×600. Design n (0–3) changes the shapes, so a few banners in a row look
 * different. The left side stays calm for the words the page puts on top.
 */
export function bannerSvg(options: { colour?: unknown; design?: unknown; name?: string }): string {
  const c = artColour(options.colour)
  const n = Math.abs(Math.floor(Number(options.design) || 0)) % 4
  const dark = shade(c, 0.25)
  const light = tint(c, 0.25)
  const lighter = tint(c, 0.45)
  const mark = escape(initials(options.name || ''))
  let shapes = ''
  if (n === 0) {
    shapes = `<circle cx="1330" cy="300" r="250" fill="${light}"/>
  <circle cx="1330" cy="300" r="170" fill="${dark}"/>
  ${bag(1330, 305, 190, lighter, '#FFFFFF')}
  <circle cx="1040" cy="110" r="46" fill="${lighter}" opacity="0.6"/>
  <circle cx="1560" cy="560" r="80" fill="${dark}"/>`
  } else if (n === 1) {
    const stripes = Array.from({ length: 9 }, (_, i) => `<rect x="${880 + i * 90}" y="-200" width="40" height="1000" fill="${i % 2 ? light : dark}" transform="rotate(20 ${900 + i * 90} 300)" opacity="0.55"/>`).join('')
    shapes = `${stripes}
  <rect x="1150" y="140" width="320" height="320" rx="60" fill="#FFFFFF"/>
  <text x="1310" y="345" text-anchor="middle" ${FONT} font-size="150" font-weight="700" fill="${c}">${mark}</text>`
  } else if (n === 2) {
    const dots = []
    for (let row = 0; row < 7; row++) for (let col = 0; col < 9; col++) dots.push(`<circle cx="${960 + col * 70}" cy="${60 + row * 80}" r="${(row + col) % 3 === 0 ? 14 : 8}" fill="${(row + col) % 2 ? light : lighter}" opacity="0.7"/>`)
    shapes = `${dots.join('')}
  ${bag(1290, 310, 300, '#FFFFFF', '#FFFFFF')}
  <rect x="1180" y="330" width="220" height="16" rx="8" fill="${c}"/>`
  } else {
    shapes = `<path d="M1000 600 A420 420 0 0 1 1600 180 V600 Z" fill="${dark}"/>
  <path d="M1150 600 A300 300 0 0 1 1600 330 V600 Z" fill="${light}"/>
  <circle cx="1420" cy="150" r="70" fill="#FFFFFF" opacity="0.9"/>
  <text x="1420" y="178" text-anchor="middle" ${FONT} font-size="76" font-weight="700" fill="${c}">${mark}</text>
  <rect x="980" y="90" width="120" height="16" rx="8" fill="${lighter}" opacity="0.7"/>
  <rect x="1010" y="130" width="70" height="16" rx="8" fill="${lighter}" opacity="0.7"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600" viewBox="0 0 1600 600">
  <rect width="1600" height="600" fill="${c}"/>
  ${shapes}
</svg>`
}

/** A round logo, 256×256: the business's initials in white on its colour. */
export function logoSvg(options: { colour?: unknown; name?: string }): string {
  const c = artColour(options.colour)
  const mark = escape(initials(options.name || ''))
  const size = mark.length > 1 ? 104 : 130
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <circle cx="128" cy="128" r="128" fill="${c}"/>
  <circle cx="128" cy="128" r="112" fill="none" stroke="${tint(c, 0.35)}" stroke-width="4"/>
  <text x="128" y="${128 + size * 0.36}" text-anchor="middle" ${FONT} font-size="${size}" font-weight="700" fill="#FFFFFF">${mark}</text>
</svg>`
}

/** A square category picture, 400×400: the category's first letter on a light tint of the colour. */
export function tileSvg(options: { colour?: unknown; name?: string; design?: unknown }): string {
  const c = artColour(options.colour)
  const n = Math.abs(Math.floor(Number(options.design) || 0)) % 4
  const bg = tint(c, [0.82, 0.88, 0.76, 0.85][n])
  const letter = escape(initials(options.name || '').slice(0, 1))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="${bg}"/>
  <circle cx="${[330, 70, 340, 60][n]}" cy="${[70, 330, 340, 60][n]}" r="90" fill="${tint(c, 0.6)}"/>
  <circle cx="200" cy="200" r="110" fill="${c}"/>
  <text x="200" y="250" text-anchor="middle" ${FONT} font-size="140" font-weight="700" fill="#FFFFFF">${letter}</text>
</svg>`
}

/** The SVG for a request's search words; null when the kind is unknown. */
export function storeArt(params: URLSearchParams): string | null {
  const kind = params.get('kind') as ArtKind | null
  const options = { colour: params.get('c'), design: params.get('n'), name: (params.get('name') || '').slice(0, 80) }
  if (kind === 'banner') return bannerSvg(options)
  if (kind === 'logo') return logoSvg(options)
  if (kind === 'tile') return tileSvg(options)
  return null
}

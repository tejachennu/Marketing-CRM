/**
 * GST invoices for shop orders (website, WhatsApp, shop / phone). Pure and browser-safe; the database
 * side is in invoice-store.ts.
 *
 * - Shop prices include GST (what the customer pays is the price on the page), so the tax is taken out
 *   of each line: taxable = price ÷ (1 + rate), tax = the rest. The invoice total is the order total.
 * - The offer (discount) is spread over the lines by their amount; the delivery charge is a line taxed at
 *   the highest rate of the goods (it goes with the goods).
 * - CGST + SGST when the goods go to the shop's own state; IGST when they go to another state (the
 *   delivery address decides). Pick up is always the shop's own state.
 * - A shop without a GSTIN gets a plain bill: no tax columns.
 * - Numbers run per financial year (April to March): "WEB/26-27/0001" (16 characters at most, as GST asks).
 */

import { amountInWords, isValidGstin, normalizeGstin } from '../salon/invoice'

export { amountInWords }

/** The GST rates a product can have (since September 2025). */
export const GST_RATES = [0, 0.25, 3, 5, 18, 40] as const

export interface InvoiceSettings {
  /** The shop's GSTIN; empty means not registered (plain bill, no tax) */
  gstin: string
  /** Name on the GST certificate, when it differs from the shop's name */
  legalName: string
  /** Address printed on the invoice (falls back to the shop's contact address) */
  address: string
  /** "WEB" in WEB/26-27/0001 */
  prefix: string
  /** Rate for products that have none of their own */
  defaultRate: number
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const text = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)

/** A GST rate from a form or the database: 0–40, two decimals; null when not a number. */
export function readRate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate < 0 || rate > 40) return null
  return round2(rate)
}

export function cleanInvoicePrefix(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'WEB'
}

export function readInvoiceSettings(raw: unknown): InvoiceSettings {
  const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const gstin = normalizeGstin(s.gstin) || ''
  return {
    gstin: isValidGstin(gstin) ? gstin : '',
    legalName: text(s.legalName, 120),
    address: text(s.address, 300),
    prefix: cleanInvoicePrefix(s.prefix),
    defaultRate: readRate(s.defaultRate) ?? 0,
  }
}

/** Settings from the form, or an error to show next to the field. */
export function parseInvoiceSettings(raw: unknown): { settings: InvoiceSettings } | { error: string; field: string } {
  const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const gstin = normalizeGstin(s.gstin) || ''
  if (gstin && !isValidGstin(gstin)) return { error: 'This GSTIN does not look right. It has 15 letters and numbers, like 36ABCDE1234F1Z5.', field: 'gstin' }
  if (s.defaultRate !== undefined && s.defaultRate !== '' && readRate(s.defaultRate) === null) return { error: 'GST rate should be between 0 and 40.', field: 'defaultRate' }
  return { settings: readInvoiceSettings({ ...s, gstin }) }
}

// ── States (GST state codes) ─────────────────────────────────────────────────

export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
}

const squash = (value: string) => value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '')

const STATE_ALIASES: Record<string, string> = {
  jk: '01', jammukashmir: '01', hp: '02', pb: '03', ch: '04', uk: '05', ut: '05', uttaranchal: '05', hr: '06',
  dl: '07', newdelhi: '07', nctofdelhi: '07', rj: '08', up: '09', br: '10', sk: '11', ar: '12', nl: '13', mn: '14',
  mz: '15', tr: '16', ml: '17', as: '18', wb: '19', jh: '20', od: '21', or: '21', orissa: '21', cg: '22', ct: '22',
  mp: '23', gj: '24', dd: '26', dn: '26', damananddiu: '26', dadraandnagarhaveli: '26', mh: '27', ka: '29', ga: '30',
  ld: '31', kl: '32', tn: '33', py: '34', pondicherry: '34', an: '35', andamanandnicobar: '35', tg: '36', ts: '36',
  telengana: '36', ap: '37', la: '38',
}

/** "Telangana", "TS", "telangana " → "36"; null when it is not an Indian state we know. */
export function stateCodeOf(name: unknown): string | null {
  const raw = String(name ?? '').trim()
  if (/^\d{2}$/.test(raw) && GST_STATES[raw]) return raw
  const key = squash(raw)
  if (!key) return null
  for (const [code, state] of Object.entries(GST_STATES)) if (squash(state) === key) return code
  return STATE_ALIASES[key] || null
}

/** The state code in a GSTIN (its first two digits). */
export function stateOfGstin(gstin: unknown): string | null {
  const value = normalizeGstin(gstin)
  return value && isValidGstin(value) && GST_STATES[value.slice(0, 2)] ? value.slice(0, 2) : null
}

// ── Numbers ──────────────────────────────────────────────────────────────────

/** "26-27" for any day from 1 April 2026 to 31 March 2027 (India time). */
export function financialYear(at: Date = new Date()): string {
  const ist = new Date(at.getTime() + 330 * 60_000)
  const year = ist.getUTCFullYear()
  const start = ist.getUTCMonth() >= 3 ? year : year - 1
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`
}

export function shopInvoiceNumber(prefix: unknown, fy: string, seq: number): string {
  return `${cleanInvoicePrefix(prefix)}/${fy}/${String(Math.max(1, Math.floor(seq))).padStart(4, '0')}`
}

// ── The maths ────────────────────────────────────────────────────────────────

export interface ShopInvoiceItemInput {
  name: string
  hsn?: string | null
  quantity: number
  unitPrice: number
  rate: number
}

export interface ShopInvoiceLine {
  name: string
  hsn: string | null
  quantity: number
  unit_price: number
  /** Before the offer, GST included */
  gross: number
  /** This line's share of the offer */
  discount: number
  rate: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
  tax: number
  /** What the customer pays for this line */
  total: number
  delivery?: boolean
}

export interface ShopInvoiceTaxRow { rate: number; taxable: number; cgst: number; sgst: number; igst: number }

export interface ShopInvoiceTotals {
  lines: ShopInvoiceLine[]
  /** Goods before the offer, GST included */
  itemsTotal: number
  delivery: number
  discount: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
  tax: number
  total: number
  taxSummary: ShopInvoiceTaxRow[]
}

export function computeShopInvoice(input: {
  items: ShopInvoiceItemInput[]
  delivery?: number
  discount?: number
  /** The shop has a GSTIN (otherwise no tax is shown) */
  registered: boolean
  interState: boolean
}): ShopInvoiceTotals {
  const goods = input.items
    .filter((item) => String(item.name || '').trim())
    .map((item) => {
      const quantity = Math.max(1, Math.round(Number(item.quantity) || 1))
      const unitPrice = round2(Math.max(0, Number(item.unitPrice) || 0))
      return {
        name: String(item.name).trim().slice(0, 200),
        hsn: item.hsn ? String(item.hsn).replace(/\D/g, '').slice(0, 8) || null : null,
        quantity, unit_price: unitPrice, gross: round2(quantity * unitPrice),
        rate: input.registered ? readRate(item.rate) ?? 0 : 0,
      }
    })
  const delivery = round2(Math.max(0, Number(input.delivery) || 0))
  const rows = [...goods]
  if (delivery > 0) {
    const rate = goods.reduce((max, g) => Math.max(max, g.rate), 0)
    rows.push({ name: 'Delivery charge', hsn: null, quantity: 1, unit_price: delivery, gross: delivery, rate, delivery: true } as any)
  }
  const grossTotal = round2(rows.reduce((sum, r) => sum + r.gross, 0))
  const discount = round2(Math.min(grossTotal, Math.max(0, Number(input.discount) || 0)))

  // Share the offer by amount; the last line takes what rounding leaves, so the shares add up exactly
  let left = discount
  const lines: ShopInvoiceLine[] = rows.map((row, index) => {
    const share = index === rows.length - 1 ? left : round2(grossTotal > 0 ? discount * (row.gross / grossTotal) : 0)
    left = round2(left - share)
    const total = round2(row.gross - share)
    const taxable = round2(total / (1 + row.rate / 100))
    const tax = round2(total - taxable)
    const cgst = input.interState ? 0 : round2(tax / 2)
    const sgst = input.interState ? 0 : round2(tax - cgst)
    return { ...row, discount: share, taxable, cgst, sgst, igst: input.interState ? tax : 0, tax, total }
  })

  const byRate = new Map<number, ShopInvoiceTaxRow>()
  for (const line of lines) {
    const row = byRate.get(line.rate) || { rate: line.rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 }
    row.taxable = round2(row.taxable + line.taxable)
    row.cgst = round2(row.cgst + line.cgst)
    row.sgst = round2(row.sgst + line.sgst)
    row.igst = round2(row.igst + line.igst)
    byRate.set(line.rate, row)
  }
  const sum = (pick: (line: ShopInvoiceLine) => number) => round2(lines.reduce((total, line) => total + pick(line), 0))
  return {
    lines,
    itemsTotal: round2(goods.reduce((s, g) => s + g.gross, 0)),
    delivery,
    discount,
    taxable: sum((l) => l.taxable),
    cgst: sum((l) => l.cgst),
    sgst: sum((l) => l.sgst),
    igst: sum((l) => l.igst),
    tax: sum((l) => l.tax),
    total: sum((l) => l.total),
    taxSummary: [...byRate.values()].sort((a, b) => a.rate - b.rate),
  }
}

/**
 * GST invoice maths for the salon counter. Pure functions, shared by the server and the screens.
 *
 * - Prices can include GST or not (a workspace setting).
 * - A discount (percent, or rupees) comes off the amount before tax, spread across the lines.
 * - Tax is CGST + SGST (half each); IGST when the customer has a GSTIN from another state.
 * - Amounts are rounded to paise per line; totals are the sum of the rounded lines.
 */

export interface InvoiceLineInput {
  service_id?: string | null
  name: string
  quantity?: number
  price: number
  tax_rate: number
  sac_code?: string | null
  /** Who did this service, when known */
  staff_id?: string | null
  staff_name?: string | null
}

export interface InvoiceLine {
  service_id: string | null
  name: string
  quantity: number
  price: number
  tax_rate: number
  sac_code: string | null
  /** Amount before tax, after the discount */
  taxable: number
  tax: number
  total: number
  staff_id?: string | null
  staff_name?: string | null
}

export interface Discount {
  type: 'percent' | 'amount'
  value: number
}

export interface TaxRow {
  rate: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
}

export interface InvoiceTotals {
  lines: InvoiceLine[]
  /** Before discount and tax */
  subtotal: number
  discount: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
  tax: number
  total: number
  taxSummary: TaxRow[]
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function computeInvoice(
  input: InvoiceLineInput[],
  options: { pricesIncludeTax?: boolean; discount?: Discount | null; interState?: boolean } = {}
): InvoiceTotals {
  const prepared = input
    .filter((line) => String(line.name || '').trim())
    .map((line) => {
      const quantity = Math.max(1, Math.round(Number(line.quantity) || 1))
      const price = Math.max(0, Number(line.price) || 0)
      const taxRate = clamp(Number(line.tax_rate) || 0, 0, 28)
      const gross = quantity * price
      const base = options.pricesIncludeTax ? gross / (1 + taxRate / 100) : gross
      return { line, quantity, price, taxRate, base }
    })

  const subtotal = prepared.reduce((sum, item) => sum + item.base, 0)
  const discountValue = Math.max(0, Number(options.discount?.value) || 0)
  const discount = options.discount?.type === 'percent'
    ? subtotal * clamp(discountValue, 0, 100) / 100
    : Math.min(subtotal, discountValue)

  const lines: InvoiceLine[] = prepared.map(({ line, quantity, price, taxRate, base }) => {
    const share = subtotal > 0 ? discount * (base / subtotal) : 0
    const taxable = round2(base - share)
    const tax = round2(taxable * taxRate / 100)
    return {
      service_id: line.service_id || null,
      name: String(line.name).trim(),
      quantity,
      price: round2(price),
      tax_rate: taxRate,
      sac_code: line.sac_code ? String(line.sac_code).trim() : null,
      taxable,
      tax,
      total: round2(taxable + tax),
      ...(line.staff_name ? { staff_id: line.staff_id || null, staff_name: String(line.staff_name) } : {}),
    }
  })

  const byRate = new Map<number, { taxable: number; tax: number }>()
  for (const line of lines) {
    const row = byRate.get(line.tax_rate) || { taxable: 0, tax: 0 }
    row.taxable += line.taxable
    row.tax += line.tax
    byRate.set(line.tax_rate, row)
  }
  const taxSummary: TaxRow[] = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, row]) => {
    const tax = round2(row.tax)
    const cgst = options.interState ? 0 : round2(tax / 2)
    return { rate, taxable: round2(row.taxable), cgst, sgst: options.interState ? 0 : round2(tax - cgst), igst: options.interState ? tax : 0 }
  })

  const sum = (pick: (row: TaxRow) => number) => round2(taxSummary.reduce((total, row) => total + pick(row), 0))
  const taxable = sum((row) => row.taxable)
  const cgst = sum((row) => row.cgst)
  const sgst = sum((row) => row.sgst)
  const igst = sum((row) => row.igst)
  const tax = round2(cgst + sgst + igst)
  return { lines, subtotal: round2(subtotal), discount: round2(discount), taxable, cgst, sgst, igst, tax, total: round2(taxable + tax), taxSummary }
}

// ── Amount in words (Indian system: thousand, lakh, crore) ───────────────────

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ')
}

function wholeInWords(n: number): string {
  if (n === 0) return 'Zero'
  const parts: string[] = []
  const crore = Math.floor(n / 10_000_000)
  const lakh = Math.floor((n % 10_000_000) / 100_000)
  const thousand = Math.floor((n % 100_000) / 1000)
  const rest = n % 1000
  if (crore) parts.push(`${wholeInWords(crore)} Crore`)
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`)
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`)
  if (rest) parts.push(belowThousand(rest))
  return parts.join(' ')
}

export function amountInWords(amount: number): string {
  const value = Math.max(0, round2(Number(amount) || 0))
  const rupees = Math.floor(value)
  const paise = Math.round((value - rupees) * 100)
  return `Rupees ${wholeInWords(rupees)}${paise ? ` and ${belowHundred(paise)} Paise` : ''} Only`
}

// ── Numbers, GSTIN ───────────────────────────────────────────────────────────

/** "SAL-0007". The prefix keeps letters, digits, "/" and "-" (at most 12). */
export function cleanInvoicePrefix(prefix: unknown): string {
  return String(prefix || '').toUpperCase().replace(/[^A-Z0-9/-]/g, '').slice(0, 12) || 'INV'
}

export function formatInvoiceNumber(prefix: unknown, seq: number): string {
  return `${cleanInvoicePrefix(prefix)}-${String(Math.max(1, Math.floor(seq))).padStart(4, '0')}`
}

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

export function normalizeGstin(value: unknown): string | null {
  const gstin = String(value || '').toUpperCase().replace(/\s/g, '')
  return gstin ? gstin : null
}

export function isValidGstin(value: unknown): boolean {
  return GSTIN_PATTERN.test(String(value || ''))
}

/** IGST applies when both GSTINs are known and from different states (the first two digits). */
export function isInterState(businessGstin: unknown, customerGstin: unknown): boolean {
  const business = normalizeGstin(businessGstin)
  const customer = normalizeGstin(customerGstin)
  if (!business || !customer || !isValidGstin(business) || !isValidGstin(customer)) return false
  return business.slice(0, 2) !== customer.slice(0, 2)
}

/** "₹1,500" for whole rupees, "₹1,911.60" when there are paise. */
export function formatRupees(amount: number): string {
  const value = Math.round((Number(amount) || 0) * 100) / 100
  const paise = !Number.isInteger(value)
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: paise ? 2 : 0, maximumFractionDigits: 2 })}`
}

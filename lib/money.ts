/**
 * The business's currency, and money in it (owner, 28 Nov 2026: "e-commerce and frontdesk and sales currency
 * configuration add in the settings"). One currency for the whole business, chosen in Settings, used by Front Desk
 * (bills, invoices), E-commerce (products, the store website, orders) and the Sales Pipeline (deals, reports).
 * Pure and safe for the browser.
 *
 * It is kept in `organizations.business_currency` (empty = not chosen = ₹ INR). The older `organizations.currency`
 * column is not trusted on its own: its database default was 'USD', so most Indian businesses had USD without ever
 * choosing it.
 */

export interface CurrencyInfo {
  code: string
  /** What goes before the amount: "₹", "$", "AED " */
  symbol: string
  name: string
  /** Number grouping: Indian (1,50,000) for rupees, else 150,000 */
  locale: string
}

/** The currencies a business can pick (India, the Gulf, the US, UK and Europe, Singapore, Australia, Canada). */
export const CURRENCIES: CurrencyInfo[] = [
  { code: 'INR', symbol: '₹', name: 'Indian rupee', locale: 'en-IN' },
  { code: 'USD', symbol: '$', name: 'US dollar', locale: 'en-US' },
  { code: 'AED', symbol: 'AED ', name: 'UAE dirham', locale: 'en-US' },
  { code: 'SAR', symbol: 'SAR ', name: 'Saudi riyal', locale: 'en-US' },
  { code: 'QAR', symbol: 'QAR ', name: 'Qatari riyal', locale: 'en-US' },
  { code: 'GBP', symbol: '£', name: 'British pound', locale: 'en-GB' },
  { code: 'EUR', symbol: '€', name: 'Euro', locale: 'en-IE' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore dollar', locale: 'en-SG' },
  { code: 'AUD', symbol: 'A$', name: 'Australian dollar', locale: 'en-AU' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian dollar', locale: 'en-CA' },
]

export const DEFAULT_CURRENCY = 'INR'

/** A currency code from the list, or null. */
export function knownCurrency(value: unknown): string | null {
  const code = String(value ?? '').trim().toUpperCase()
  return CURRENCIES.some((c) => c.code === code) ? code : null
}

/** A currency code from the list; anything else is INR. */
export function readCurrency(value: unknown): string {
  return knownCurrency(value) || DEFAULT_CURRENCY
}

export function currencyInfo(code: unknown): CurrencyInfo {
  return CURRENCIES.find((c) => c.code === readCurrency(code))!
}

/** The business's currency from its organization row: the one chosen in Settings, else INR. */
export function businessCurrency(org: { business_currency?: unknown } | null | undefined): string {
  return readCurrency(org?.business_currency)
}

/** "₹1,500", "₹1,911.60", "$1,500", "AED 1,250.50": whole amounts without decimals, else two. */
export function moneyText(amount: number | string | null | undefined, currency: unknown = DEFAULT_CURRENCY): string {
  const info = currencyInfo(currency)
  const value = Math.round((Number(amount) || 0) * 100) / 100
  const negative = value < 0
  const cents = !Number.isInteger(value)
  const digits = Math.abs(value).toLocaleString(info.locale, { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })
  return `${negative ? '−' : ''}${info.symbol}${digits}`
}

/** "₹1,911.60", "$12.00": always two decimals, so amounts line up in invoice columns. */
export function moneyFixed(amount: number | string | null | undefined, currency: unknown = DEFAULT_CURRENCY): string {
  const info = currencyInfo(currency)
  const value = Math.round((Number(amount) || 0) * 100) / 100
  const digits = Math.abs(value).toLocaleString(info.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${value < 0 ? '−' : ''}${info.symbol}${digits}`
}

/** "Indian rupees", "US dollars", "UAE dirhams": for sentences such as "Prices are in …". */
export function currencyWords(currency: unknown = DEFAULT_CURRENCY): string {
  return `${currencyInfo(currency).name}s`
}

// ── The currency the screens show (browser only) ─────────────────────────────
// One business per browser tab: the dashboard sets it when the workspace loads, so every amount on the screens
// follows the business's currency without each screen asking for it. The server never uses this (many businesses
// share one server): server code passes the currency itself.

let screenCurrencyCode = DEFAULT_CURRENCY

/** Sent on `window` by Settings when the currency changes (detail: the code); the dashboard redraws its pages. */
export const CURRENCY_EVENT = 'wama-currency-changed'

export function setScreenCurrency(code: unknown): void {
  screenCurrencyCode = readCurrency(code)
}

/** The business's currency on the screens; INR on the server. */
export function screenCurrency(): string {
  return typeof window === 'undefined' ? DEFAULT_CURRENCY : screenCurrencyCode
}

/** "₹", "$", "AED": the symbol alone, for labels such as "Price (₹)". The screens' currency unless one is given. */
export function currencySymbol(currency?: unknown): string {
  return currencyInfo(currency ?? screenCurrency()).symbol.trim()
}

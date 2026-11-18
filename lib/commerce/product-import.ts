/**
 * Products from a spreadsheet (Excel or CSV). Pure and browser-safe: the upload screen shows the same
 * check the server makes before saving.
 *
 * - Columns are found by their heading, in English words a shopkeeper would write ("Name", "Price",
 *   "Stock"…), in any order and case. Only Name and Price are needed.
 * - A row with a SKU that already exists updates that product; otherwise a new product is added. Rows
 *   without a SKU get one made from the name.
 */

import { parseProductInput, type ProductInput } from './commerce-utils'
import { readRate } from './invoice'

export const MAX_IMPORT_ROWS = 500

export const IMPORT_COLUMNS = [
  { key: 'title', heading: 'Name', names: ['name', 'product', 'product name', 'title', 'item', 'item name'] },
  { key: 'price', heading: 'Price', names: ['price', 'mrp', 'selling price', 'rate', 'amount', 'price (₹)', 'price (rs)'] },
  { key: 'retailer_id', heading: 'SKU', names: ['sku', 'code', 'item code', 'product code', 'id', 'barcode'] },
  { key: 'category', heading: 'Category', names: ['category', 'type', 'group', 'section'] },
  { key: 'inventory_count', heading: 'Stock', names: ['stock', 'quantity', 'qty', 'inventory', 'in stock', 'available'] },
  { key: 'description', heading: 'Description', names: ['description', 'details', 'about'] },
  { key: 'image_url', heading: 'Photo link', names: ['photo', 'photo link', 'image', 'image link', 'image url', 'photo url', 'picture'] },
  { key: 'weight_grams', heading: 'Weight (grams)', names: ['weight', 'weight (grams)', 'weight (g)', 'grams'] },
  { key: 'hsn_code', heading: 'HSN', names: ['hsn', 'hsn code'] },
  { key: 'gst_rate', heading: 'GST %', names: ['gst', 'gst %', 'gst rate', 'tax', 'tax %'] },
] as const

export type ImportKey = (typeof IMPORT_COLUMNS)[number]['key']

export interface ImportedProduct extends ProductInput {
  weight_grams: number | null
  hsn_code: string | null
  gst_rate: number | null
  /** The SKU was made from the name (the sheet had none) */
  madeSku: boolean
  /** Columns this row filled in (an update changes only these) */
  given: ImportKey[]
}

export interface ImportCheck {
  products: ImportedProduct[]
  /** "Row 4: Enter a valid price (0 or more)" */
  errors: string[]
  /** Headings that were not understood (ignored) */
  ignored: string[]
}

const squash = (value: unknown) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Which column each heading is ("Product Name" → title). */
export function mapHeadings(headings: unknown[]): { map: Partial<Record<ImportKey, number>>; ignored: string[] } {
  const map: Partial<Record<ImportKey, number>> = {}
  const ignored: string[] = []
  headings.forEach((raw, index) => {
    const h = squash(raw)
    if (!h) return
    const column = IMPORT_COLUMNS.find((c) => (c.names as readonly string[]).includes(h))
    if (column && map[column.key] === undefined) map[column.key] = index
    else ignored.push(String(raw).trim())
  })
  return { map, ignored }
}

/** A SKU from the name: "Cotton Saree (Red)" → "COTTON-SAREE-RED". */
export function skuFromName(name: string, taken: Set<string>): string {
  const base = String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ITEM'
  let sku = base
  for (let n = 2; taken.has(sku); n++) sku = `${base}-${n}`
  taken.add(sku)
  return sku
}

const money = (value: unknown) => {
  if (typeof value === 'number') return value
  const cleaned = String(value ?? '').replace(/[₹,\s]|rs\.?|inr/gi, '')
  return cleaned === '' ? '' : Number(cleaned)
}

/** The sheet as rows (first row = headings) → products to save, and what is wrong, row by row. */
export function checkImport(rows: unknown[][], currency = 'INR'): ImportCheck {
  const [headings = [], ...body] = rows
  const { map, ignored } = mapHeadings(headings)
  const errors: string[] = []
  if (map.title === undefined || map.price === undefined) {
    return { products: [], errors: ['The first row needs the headings Name and Price (download the sample to see all of them).'], ignored }
  }
  const filled = body.map((row, i) => ({ row, line: i + 2 })).filter(({ row }) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim()))
  if (filled.length > MAX_IMPORT_ROWS) errors.push(`Only the first ${MAX_IMPORT_ROWS} products are taken. Split the sheet for more.`)
  const taken = new Set<string>()
  const products: ImportedProduct[] = []
  for (const { row, line } of filled.slice(0, MAX_IMPORT_ROWS)) {
    const cell = (key: ImportKey) => (map[key] === undefined ? '' : row[map[key]!])
    try {
      let sku = String(cell('retailer_id') ?? '').trim()
      const madeSku = !sku
      if (sku && taken.has(sku.toUpperCase())) throw new Error(`The SKU ${sku} is used twice in the sheet`)
      if (sku) taken.add(sku.toUpperCase())
      else sku = skuFromName(String(cell('title') ?? ''), taken)
      const stock = cell('inventory_count')
      const input = parseProductInput({
        title: String(cell('title') ?? '').trim(), retailer_id: sku, price: money(cell('price')), currency,
        category: cell('category'), description: cell('description'), image_url: String(cell('image_url') ?? '').trim() || null,
        inventory_count: stock === '' || stock === null || stock === undefined ? '' : Number(String(stock).replace(/[,\s]/g, '')),
      })
      const grams = Number(cell('weight_grams'))
      const hsn = String(cell('hsn_code') ?? '').replace(/\D/g, '').slice(0, 8)
      const gstRaw = String(cell('gst_rate') ?? '').replace('%', '').trim()
      const gst = readRate(gstRaw)
      if (gstRaw && gst === null) throw new Error('GST % should be a number like 5 or 18')
      const given = IMPORT_COLUMNS.map((c) => c.key).filter((key) => String(cell(key) ?? '').trim() !== '')
      products.push({ ...input, given, weight_grams: Number.isFinite(grams) && grams > 0 && grams <= 100000 ? Math.round(grams) : null, hsn_code: hsn.length >= 4 ? hsn : null, gst_rate: gst, madeSku })
    } catch (error: any) {
      errors.push(`Row ${line}: ${error?.message || 'could not be read'}`)
    }
  }
  return { products, errors, ignored }
}

/** The sample sheet (CSV) with every heading and two example rows. */
export function sampleCsv(): string {
  const head = IMPORT_COLUMNS.map((c) => c.heading)
  const rows = [
    ['Cotton saree (red)', '1299', 'SAREE-RED', 'Sarees', '12', 'Soft handloom cotton, 6.3 m with blouse piece.', '', '600', '5208', '5'],
    ['Steel water bottle 1 L', '449', '', 'Kitchen', '', '', '', '350', '7323', '18'],
  ]
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return [head, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n'
}

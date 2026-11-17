/**
 * Product options (Size, Colour, Weight…) and their combinations ("Red / L"), each with its own price, stock,
 * SKU and photo. Pure rules with no imports: safe in the browser (Products tab, store page) and in tests.
 *
 * A product's options live in commerce_products.options ([{ name, values }]); each combination is a row in
 * commerce_product_variants (see variant-store.ts). A product without options sells as before.
 */

export const MAX_OPTIONS = 3
export const MAX_VALUES = 20
export const MAX_VARIANTS = 100

export interface ProductOption {
  name: string
  values: string[]
}

export interface Variant {
  id?: string
  options: Record<string, string>
  name: string
  sku: string | null
  /** null = the product's own price */
  price: number | null
  /** null = stock not tracked */
  stock: number | null
  image_url: string | null
  active: boolean
  position?: number
}

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Up to 3 options with up to 20 distinct values each; empty ones dropped; at most 100 combinations. */
export function cleanOptions(raw: unknown): { options: ProductOption[] } | { error: string } {
  const list = Array.isArray(raw) ? raw : []
  const options: ProductOption[] = []
  const names = new Set<string>()
  for (const item of list) {
    const name = clean((item as any)?.name, 30)
    const rawValues = Array.isArray((item as any)?.values) ? (item as any).values : String((item as any)?.values ?? '').split(',')
    const values: string[] = []
    for (const v of rawValues) {
      const value = clean(v, 40)
      if (value && !values.some((x) => x.toLowerCase() === value.toLowerCase())) values.push(value)
    }
    if (!name && !values.length) continue
    if (!name) return { error: 'Give every option a name, like Size or Colour.' }
    if (!values.length) return { error: `Add the choices for ${name}, separated by commas (for example S, M, L).` }
    if (names.has(name.toLowerCase())) return { error: `There are two options called ${name}.` }
    if (values.length > MAX_VALUES) return { error: `${name} can have at most ${MAX_VALUES} choices.` }
    names.add(name.toLowerCase())
    options.push({ name, values })
  }
  if (options.length > MAX_OPTIONS) return { error: `A product can have at most ${MAX_OPTIONS} options.` }
  const count = options.reduce((n, o) => n * o.values.length, options.length ? 1 : 0)
  if (count > MAX_VARIANTS) return { error: `That makes ${count} combinations; the most is ${MAX_VARIANTS}. Use fewer choices.` }
  return { options }
}

/** "Red / L" from { Colour: "Red", Size: "L" } in the options' order. */
export function variantName(options: ProductOption[], picked: Record<string, string>): string {
  return options.map((o) => picked[o.name]).filter(Boolean).join(' / ')
}

/** Every combination of the options, in order (first option changes slowest). */
export function combinations(options: ProductOption[]): Record<string, string>[] {
  if (!options.length) return []
  let out: Record<string, string>[] = [{}]
  for (const o of options) out = out.flatMap((c) => o.values.map((v) => ({ ...c, [o.name]: v })))
  return out
}

const keyOf = (options: ProductOption[], picked: Record<string, string>) => options.map((o) => `${o.name.toLowerCase()}=${String(picked[o.name] ?? '').toLowerCase()}`).join('|')

/**
 * The variant rows for these options: one per combination. A combination that already existed keeps its
 * id, price, stock, SKU and photo (so adding a colour does not wipe the sizes' prices).
 */
export function buildVariants(options: ProductOption[], existing: Partial<Variant>[] = [], edits: Partial<Variant>[] = []): Variant[] {
  const before = new Map(existing.map((v) => [keyOf(options, v.options || {}), v]))
  const typed = new Map(edits.map((v) => [keyOf(options, v.options || {}), v]))
  return combinations(options).map((picked, position) => {
    const key = keyOf(options, picked)
    const base = { ...(before.get(key) || {}), ...(typed.get(key) || {}) }
    const price = base.price === null || base.price === undefined || (base.price as any) === '' ? null : Number(base.price)
    const stock = base.stock === null || base.stock === undefined || (base.stock as any) === '' ? null : Math.round(Number(base.stock))
    return {
      ...(base.id ? { id: base.id } : {}),
      options: picked,
      name: variantName(options, picked),
      sku: clean(base.sku, 100) || null,
      price: price !== null && Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : null,
      stock: stock !== null && Number.isFinite(stock) && stock >= 0 ? stock : null,
      image_url: /^https:\/\//.test(String(base.image_url || '')) ? String(base.image_url).slice(0, 1000) : null,
      active: base.active !== false,
      position,
    }
  })
}

export function variantPrice(variant: Pick<Variant, 'price'>, productPrice: number): number {
  return variant.price === null || variant.price === undefined ? productPrice : Number(variant.price)
}

export function variantInStock(variant: Pick<Variant, 'stock' | 'active'>): boolean {
  return variant.active !== false && (variant.stock === null || variant.stock === undefined || variant.stock > 0)
}

/** The variant that matches every picked option, if the shopper has picked them all. */
export function findVariant<T extends Pick<Variant, 'options'>>(variants: T[], picked: Record<string, string>, options: ProductOption[]): T | null {
  if (!options.length || options.some((o) => !picked[o.name])) return null
  return variants.find((v) => options.every((o) => v.options[o.name] === picked[o.name])) || null
}

/** Can this value still be picked, given the other picks (some combination with it is in stock)? */
export function valueAvailable(variants: { options: Record<string, string>; inStock?: boolean; stock?: number | null; active?: boolean }[], options: ProductOption[], picked: Record<string, string>, option: string, value: string): boolean {
  const ok = (v: (typeof variants)[number]) => (v.inStock !== undefined ? v.inStock : variantInStock({ stock: v.stock ?? null, active: v.active !== false }))
  return variants.some((v) => ok(v) && v.options[option] === value && options.every((o) => o.name === option || !picked[o.name] || v.options[o.name] === picked[o.name]))
}

/** Lowest and highest price over the variants that are on sale (for "from ₹499"). */
export function priceRange(productPrice: number, variants: Pick<Variant, 'price' | 'active' | 'stock'>[]): { min: number; max: number } {
  const prices = variants.filter((v) => v.active !== false).map((v) => variantPrice(v, productPrice))
  if (!prices.length) return { min: productPrice, max: productPrice }
  return { min: Math.min(...prices), max: Math.max(...prices) }
}

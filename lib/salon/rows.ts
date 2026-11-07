/**
 * Every row a query matches, a page at a time. The database API returns at most 1,000 rows per
 * call, so a long date range is read in pages (up to `max` rows).
 */

export async function allRows<T = any>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  { pageSize = 1000, max = 20_000 }: { pageSize?: number; max?: number } = {},
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = []
  while (rows.length < max) {
    const size = Math.min(pageSize, max - rows.length)
    const { data, error } = await page(rows.length, rows.length + size - 1)
    if (error) throw new Error(error.message || 'The records could not be loaded.')
    rows.push(...(data || []))
    if (!data || data.length < size) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

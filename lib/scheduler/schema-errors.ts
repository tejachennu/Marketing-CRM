/**
 * How PostgREST reports a column or table that a migration has not added yet. The scheduled
 * jobs check for these so a tick keeps running, and says what is missing, instead of failing.
 */
export interface DatabaseError {
  code?: string
  message?: string
}

// 42703: undefined column (reads and filters); PGRST204: column missing from the schema cache (writes)
const MISSING_COLUMN_CODES = ['42703', 'PGRST204']
// 42P01: undefined table; PGRST205: table missing from the schema cache
const MISSING_TABLE_CODES = ['42P01', 'PGRST205']

/** True when the error says a column does not exist; `columns` narrows the message check to those names. */
export function isMissingColumn(error: DatabaseError | null | undefined, columns: string[] = []): boolean {
  if (!error) return false
  if (MISSING_COLUMN_CODES.includes(error.code || '')) return true
  const message = error.message || ''
  if (!/does not exist|could not find|schema cache/i.test(message)) return false
  return columns.length === 0 || columns.some((column) => message.includes(column))
}

export function isMissingTable(error: DatabaseError | null | undefined): boolean {
  if (!error) return false
  return MISSING_TABLE_CODES.includes(error.code || '') || /relation .* does not exist|could not find the table/i.test(error.message || '')
}

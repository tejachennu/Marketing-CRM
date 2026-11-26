/**
 * Shop holidays in the database: salon_settings.holidays (a JSON list, rules in holidays.ts). Settings are read
 * with select('*'), so reading never needs the column (none yet = no holidays); it is added the first time a holiday
 * is saved. Server only.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'
import { withSalonSchema } from './schema'
import { HOLDING_STATUSES } from './availability'
import { dropOldHolidays, holidaySpans, readHolidays, type Holiday } from './holidays'
import { addDays, istDate, istDayRange } from './spoken'

/** supabase/migrations/20261214_front_desk_holidays.sql word for word. */
export const HOLIDAYS_SQL = `-- Front Desk: shop holidays. Days the business is closed besides its weekly closed days: one-off (Diwali this year)
-- or repeating every year, every month on a date, or every month on a weekday (the 2nd Tuesday). On a holiday no
-- times are offered for bookings, the website says it is closed, and attendance does not count it as a working day.
-- A JSON list: [{ id, name, start, days, repeat }]. Safe to run more than once. The app runs it on its own the first
-- time a holiday is saved.
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS holidays JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
`

export const HOLIDAYS_LOCK = 724519041
export const holidaysSchemaSetup = createAutoSetup('Front Desk holidays', (connectionString) => runMigrationSql(connectionString, HOLIDAYS_SQL, HOLIDAYS_LOCK))

/** Run a step that writes holidays; when the column is not there yet, add it and try again (a few tries while Supabase notices it). */
export async function withHolidaysSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = holidaysSchemaSetup): Promise<any> {
  const missing = (error: any) => isMissingSchemaError(error, /holidays/)
  const first = await step()
  if (!missing(first.error)) return first
  if (!(await setup.ensure())) return first
  let result = await step()
  for (let attempt = 1; attempt < 4 && missing(result.error); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    result = await step()
  }
  return result
}

/** The business's holidays (none when the column is not there yet). */
export async function loadHolidays(db: any, organizationId: string): Promise<Holiday[]> {
  const { data } = await withSalonSchema(() => db.from('salon_settings').select('*').eq('organization_id', organizationId).maybeSingle())
  return readHolidays(data?.holidays)
}

/** Save the whole list (one-off holidays that ended over a year ago are dropped). Returns the saved list. */
export async function saveHolidays(db: any, organizationId: string, list: Holiday[]): Promise<Holiday[]> {
  const value = dropOldHolidays(readHolidays(list))
  const save = () => db.from('salon_settings')
    .upsert({ organization_id: organizationId, holidays: value, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' })
    .select('*').single()
  const { data, error } = await withSalonSchema(() => withHolidaysSchema(save))
  if (error) throw new Error(error.message || 'The holidays could not be saved.')
  return readHolidays(data?.holidays ?? value)
}

/**
 * Bookings already made on this holiday's days in the next `withinDays` days (they stay: the team calls those
 * customers). Never throws: 0 when they cannot be read.
 */
export async function bookingsOnHoliday(db: any, organizationId: string, holiday: Holiday, now = Date.now(), withinDays = 90): Promise<{ count: number; days: string[] }> {
  try {
    const today = istDate(now)
    const spans = holidaySpans([holiday], today, addDays(today, withinDays))
    let count = 0
    const days = new Set<string>()
    for (const span of spans.slice(0, 12)) {
      const { data, error } = await db.from('salon_appointments').select('starts_at, status')
        .eq('organization_id', organizationId).gte('starts_at', istDayRange(span.start < today ? today : span.start).start).lt('starts_at', istDayRange(span.end).end)
      if (error || !Array.isArray(data)) continue
      for (const row of data) {
        if (!HOLDING_STATUSES.includes(row.status)) continue
        count += 1
        days.add(istDate(row.starts_at))
      }
    }
    return { count, days: [...days].sort() }
  } catch {
    return { count: 0, days: [] }
  }
}

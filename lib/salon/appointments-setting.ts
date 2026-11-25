/**
 * The "We take appointments" setting in the database: salon_settings.takes_appointments (on by default, so nothing
 * changes for existing businesses). Rules are in appointments-switch.ts. The column is added the first time the
 * switch is saved; reading never needs it (settings are read with select('*') and a missing value counts as on).
 * Server only.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'

/** supabase/migrations/20261213_front_desk_take_appointments.sql word for word. */
export const APPOINTMENTS_SQL = `-- Front Desk: "We take appointments". Shops that only bill walk-ins switch it off: bookings, the calendar, the
-- booking page, booking on WhatsApp and reminders are hidden; walk-in bills, invoices, reviews, memberships and the
-- team stay. On by default, so nothing changes for existing businesses. Safe to run more than once. The app runs it
-- on its own the first time the switch is saved.
ALTER TABLE salon_settings ADD COLUMN IF NOT EXISTS takes_appointments BOOLEAN NOT NULL DEFAULT TRUE;

NOTIFY pgrst, 'reload schema';
`

export const APPOINTMENTS_LOCK = 724519040
export const appointmentsSchemaSetup = createAutoSetup('Front Desk appointments switch', (connectionString) => runMigrationSql(connectionString, APPOINTMENTS_SQL, APPOINTMENTS_LOCK))

/**
 * Run a step that writes takes_appointments; when the column is not there yet, add it and try again (Supabase's API
 * notices a new column a moment later, so a few tries).
 */
export async function withAppointmentsSchema(step: () => PromiseLike<any>, setup: { ensure: () => Promise<boolean> } = appointmentsSchemaSetup): Promise<any> {
  const missing = (error: any) => isMissingSchemaError(error, /takes_appointments/)
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

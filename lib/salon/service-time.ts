/**
 * "Takes time" on a Front Desk service: salon_services.takes_time, on by default (owner, 28 Nov 2026: "Prati service ki
 * time vundadu just billing vuntadi time enable disable option evu"). Off = billing only: no minutes anywhere, and
 * customers cannot book it (left out of the booking page, the website, WhatsApp booking and the counter's New booking);
 * it still goes on bills and adds no time to a walk-in visit.
 *
 * The column is added the first time the switch is saved; reading never needs it (services are read with select('*')
 * and a missing value counts as on). Server only.
 */

import { createAutoSetup, isMissingSchemaError, runMigrationSql } from '../schema-setup'

/** supabase/migrations/20261215_front_desk_service_time.sql word for word. */
export const SERVICE_TIME_SQL = `-- Front Desk: "Takes time" on each service. Off = billing only: no minutes, and customers cannot book it (booking
-- page, website, WhatsApp booking, the counter's New booking); it still goes on bills. On by default, so nothing
-- changes for existing services. Safe to run more than once. The app runs it on its own the first time it is saved.
ALTER TABLE salon_services ADD COLUMN IF NOT EXISTS takes_time BOOLEAN NOT NULL DEFAULT TRUE;

NOTIFY pgrst, 'reload schema';
`

export const SERVICE_TIME_LOCK = 724519042
export const serviceTimeSchemaSetup = createAutoSetup('Front Desk service time', (connectionString) => runMigrationSql(connectionString, SERVICE_TIME_SQL, SERVICE_TIME_LOCK))

/** Does this service take time (can it be booked)? A missing value counts as yes. */
export const takesTime = (service: { takes_time?: boolean | null } | null | undefined) => service?.takes_time !== false

const missing = (error: any) => isMissingSchemaError(error, /takes_time/)

type Saved = { data?: any; error?: any }

/**
 * Save a service row (insert or update) that may carry takes_time. When the column is not there yet, add it and try
 * again (Supabase's API notices a new column a moment later, so a few tries). If it still cannot be added (no database
 * connection), a "takes time: on" save goes through without it, since on is the default.
 */
export async function saveWithServiceTime(values: Record<string, any>, write: (values: Record<string, any>) => PromiseLike<Saved>, setup: { ensure: () => Promise<boolean> } = serviceTimeSchemaSetup): Promise<Saved> {
  const first = await write(values)
  if (!missing(first.error) || !('takes_time' in values)) return first
  if (await setup.ensure()) {
    let result = await write(values)
    for (let attempt = 1; attempt < 4 && missing(result.error); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
      result = await write(values)
    }
    if (!missing(result.error)) return result
  }
  if (values.takes_time === false) return first
  const { takes_time: _default, ...rest } = values
  return write(rest)
}

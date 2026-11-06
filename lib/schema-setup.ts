/**
 * Database set-up that runs from the app itself: the owner never has to paste SQL into Supabase.
 * A migration runs through the app's own database connection on Vercel (POSTGRES_URL_NON_POOLING,
 * POSTGRES_URL or DATABASE_URL), in one transaction, one run at a time. Used by billing and by the
 * Spa & Salon connector.
 */

import { Client } from 'pg'

/** The connection the app uses for direct database work, or null when none is set. */
export function migrationConnectionString(env: Record<string, string | undefined> = process.env): string | null {
  const raw = String(env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.DATABASE_URL || '').trim()
  if (!raw) return null
  try {
    // TLS is set below; connection-string TLS and pooler options would override it
    const url = new URL(raw)
    for (const key of ['sslmode', 'supa', 'pgbouncer', 'sslrootcert']) url.searchParams.delete(key)
    return url.toString()
  } catch {
    return null
  }
}

/** Run a migration in one transaction (all of it applies, or none of it), one run at a time per lock. */
export async function runMigrationSql(connectionString: string, sql: string, lock: number, ClientClass: typeof Client = Client): Promise<void> {
  // Supabase signs its database certificate with its own root, which the server does not carry
  const client = new ClientClass({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 60000 })
  await client.connect()
  try {
    await client.query('BEGIN')
    // Requests arriving together all try to set up: the first runs, the others wait and find it done
    await client.query(`SELECT pg_advisory_xact_lock(${lock})`)
    await client.query(sql)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end().catch(() => {})
  }
}

/**
 * Run `setup` when needed, at most once per server instance every ten minutes, so a failing
 * connection is not retried on every request. Returns true when it ran.
 */
export function createAutoSetup(name: string, setup: (connectionString: string) => Promise<void>, retryAfterMs = 10 * 60 * 1000) {
  let lastAttempt = 0
  let running: Promise<boolean> | null = null
  return {
    async ensure(now = Date.now()): Promise<boolean> {
      const connectionString = migrationConnectionString()
      if (!connectionString) return false
      if (running) return running
      if (now - lastAttempt < retryAfterMs) return false
      lastAttempt = now
      running = (async () => {
        try {
          await setup(connectionString)
          console.log(`[${name}] Database tables set up`)
          return true
        } catch (error: any) {
          console.error(`[${name}] Could not set up the database tables:`, error?.message)
          return false
        } finally {
          running = null
        }
      })()
      return running
    },
    reset() {
      lastAttempt = 0
      running = null
    },
  }
}

/** True for the error Supabase returns when a table (or column) does not exist yet. */
export function isMissingSchemaError(error: any, pattern: RegExp): boolean {
  if (!error) return false
  const code = String(error.code || '')
  return code === '42P01' || code === '42703' || code === 'PGRST205' || code === 'PGRST204' || pattern.test(String(error.message || ''))
}

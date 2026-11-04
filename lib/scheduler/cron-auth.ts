import { timingSafeEqual } from 'node:crypto'

export type CronAuthResult = { ok: true } | { ok: false; status: 401 | 503; error: string }

/** Constant-time comparison, so a wrong secret cannot be guessed byte by byte from response times. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The secrets a scheduler may present: CRON_SECRET, which Vercel Cron sends on its own, and
 * PG_CRON_SECRET, a second value meant for the pg_cron path. That one ends up in the database's
 * cron.job table, readable by anyone with database access, so it is better rotated on its own
 * without touching the one Vercel holds.
 */
export function cronSecretsFromEnv(env: NodeJS.ProcessEnv = process.env): Array<string | undefined> {
  return [env.CRON_SECRET, env.PG_CRON_SECRET]
}

/** The secret the tick presents when it calls back into the app (to start a campaign worker); none when nothing is configured. */
export function configuredCronSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return cronSecretsFromEnv(env).map((value) => String(value || '').trim()).find(Boolean)
}

/**
 * The tick accepts `Authorization: Bearer <secret>`, which Vercel Cron sends on its own once
 * the CRON_SECRET environment variable is set, or `x-cron-secret: <secret>` from any other
 * scheduler (pg_cron, a curl in a shell). Without a configured secret nothing may run the
 * jobs: an open tick would let anyone send reminders and start campaigns at will.
 */
export function authorizeCronRequest(headers: Headers, secret: string | undefined | ReadonlyArray<string | undefined>): CronAuthResult {
  const expected = (Array.isArray(secret) ? secret : [secret]).map((value) => String(value || '').trim()).filter(Boolean)
  if (expected.length === 0) return { ok: false, status: 503, error: 'CRON_SECRET is not configured' }

  const bearer = String(headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1]
  const given = [bearer, headers.get('x-cron-secret')].map((value) => String(value || '').trim()).filter(Boolean)
  if (!given.some((value) => expected.some((candidate) => sameSecret(value, candidate)))) return { ok: false, status: 401, error: 'Unauthorized' }
  return { ok: true }
}

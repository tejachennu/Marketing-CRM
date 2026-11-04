import { timingSafeEqual } from 'node:crypto'

export type CronAuthResult = { ok: true } | { ok: false; status: 401 | 503; error: string }

/** Constant-time comparison, so a wrong secret cannot be guessed byte by byte from response times. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The tick accepts `Authorization: Bearer <CRON_SECRET>`, which Vercel Cron sends on its own
 * once the CRON_SECRET environment variable is set, or `x-cron-secret: <CRON_SECRET>` from any
 * other scheduler (pg_cron, a curl in a shell). Without a configured secret nothing may run
 * the jobs: an open tick would let anyone send reminders and start campaigns at will.
 */
export function authorizeCronRequest(headers: Headers, secret: string | undefined): CronAuthResult {
  const expected = String(secret || '').trim()
  if (!expected) return { ok: false, status: 503, error: 'CRON_SECRET is not configured' }

  const bearer = String(headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1]
  const given = [bearer, headers.get('x-cron-secret')].map((value) => String(value || '').trim()).filter(Boolean)
  if (!given.some((value) => sameSecret(value, expected))) return { ok: false, status: 401, error: 'Unauthorized' }
  return { ok: true }
}

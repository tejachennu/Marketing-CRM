/**
 * How a campaign worker is started from the scheduler, and the conventions it shares with the
 * watchdog in lib/campaigns/dispatcher.ts. They live here so the dispatcher and the worker
 * route need not import each other for a constant.
 */

/** Where a campaign worker can be started in an invocation of its own. */
export const WORKER_ROUTE_PATH = '/api/campaigns/run/worker'
/**
 * The worker route answers 202 before it does any work, so a start that takes longer than
 * this is a network problem, not a slow worker. Fire and forget: the tick does not wait for
 * the campaign.
 */
export const START_TIMEOUT_MS = 5 * 1000
/** A worker stops starting batches when less than this is left of its invocation. */
export const STOP_MARGIN_MS = 10 * 1000
/**
 * The heartbeat a worker leaves when it stopped on purpose (out of time, messages still
 * pending). The watchdog resumes campaigns whose heartbeat is older than a couple of minutes,
 * so a heartbeat at the epoch is picked up by the very next dispatch, from any caller.
 */
export const RESUME_REQUESTED_AT = '1970-01-01T00:00:00.000Z'
/**
 * Logs a worker claimed (SENDING) but never settled are given back to PENDING once the
 * campaign's heartbeat is this old. A live worker refreshes the heartbeat after every batch,
 * and a batch cannot take anywhere near this long (every provider call times out after 15 s),
 * so such logs can only come from a worker that was killed mid-batch.
 */
export const SENDING_RESET_AFTER_MS = 10 * 60 * 1000

/**
 * When a worker started now must be done. `maxDurationSeconds` is what the route declares;
 * CAMPAIGN_WORKER_MAX_SECONDS overrides it for a project whose plan allows less than that,
 * so the worker pauses cleanly instead of being killed mid-batch.
 */
export function workerDeadline(maxDurationSeconds: number, env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.CAMPAIGN_WORKER_MAX_SECONDS)
  const budgetSeconds = Number.isFinite(configured) && configured > 0 ? configured : maxDurationSeconds
  return Date.now() + budgetSeconds * 1000
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>
/** Starts a campaign's worker some other way; see StartWorker in lib/campaigns/dispatcher.ts. */
export type FallbackStart = (campaignId: string, context: string) => void | Promise<void>

/**
 * Start a campaign's worker in an invocation of its own: POST /api/campaigns/run/worker with
 * the cron secret. Used by the cron tick, whose own invocation ends with the tick; a worker
 * started with `after()` there would only get what is left of the tick's minute.
 *
 * Resolves once the route answered 202. A timeout is logged and otherwise ignored: the
 * request was sent, and the worker route needs no answer from us to run. Any other failure
 * (the route unreachable, a deployment-protection page, an error answer) goes to `fallback`
 * when there is one, and is otherwise thrown for the caller to count; the watchdog then
 * resumes the campaign a couple of minutes later, from the next tick or dashboard poll.
 */
export function startWorkerInOwnInvocation({
  origin,
  secret,
  fallback,
  fetcher = fetch,
  env = process.env,
}: {
  /** The deployment to call back, normally the origin the tick was called on. */
  origin: string
  /** The cron secret the worker route accepts. */
  secret: string
  fallback?: FallbackStart
  fetcher?: Fetcher
  env?: NodeJS.ProcessEnv
}): (campaignId: string, context: string) => Promise<void> {
  const url = `${origin.replace(/\/+$/, '')}${WORKER_ROUTE_PATH}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-cron-secret': secret }
  // A Vercel project with Deployment Protection on would otherwise answer the call with its sign-in page
  if (env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = env.VERCEL_AUTOMATION_BYPASS_SECRET

  return async (campaignId, context) => {
    let failure: string | null = null
    try {
      const response = await fetcher(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ campaignId }),
        signal: AbortSignal.timeout(START_TIMEOUT_MS),
      })
      if (!response.ok) {
        const detail = await response.text().then((text) => text.slice(0, 200)).catch(() => '')
        failure = `${WORKER_ROUTE_PATH} answered ${response.status}${detail ? `: ${detail}` : ''}`
      }
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        console.warn(`[Campaign Dispatcher] ${context}: no answer from ${WORKER_ROUTE_PATH} within ${START_TIMEOUT_MS / 1000}s for campaign ${campaignId}; assuming it started.`)
        return
      }
      failure = `${WORKER_ROUTE_PATH} could not be reached: ${err?.message || err}`
    }
    if (!failure) return

    if (!fallback) throw new Error(failure)
    console.warn(`[Campaign Dispatcher] ${context}: ${failure}; running the worker for campaign ${campaignId} here instead.`)
    await fallback(campaignId, context)
  }
}

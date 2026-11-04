export interface JobReport {
  ok: boolean
  duration_ms: number
  error?: string
  [detail: string]: unknown
}

/** Run one job of a tick. A failure is reported in the tick's summary and never stops the other jobs. */
export async function runJob<T extends object>(name: string, job: () => Promise<T>): Promise<JobReport> {
  const startedAt = Date.now()
  try {
    const result = await job()
    return { ...result, ok: true, duration_ms: Date.now() - startedAt }
  } catch (err: any) {
    console.error(`[Cron Tick] ${name} failed:`, err)
    return { ok: false, duration_ms: Date.now() - startedAt, error: err?.message || String(err) }
  }
}

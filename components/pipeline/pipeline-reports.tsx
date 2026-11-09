'use client'

/** How sales are going in a date range: open pipeline, won and lost, by stage, by source and by person. */

import { useEffect, useState } from 'react'
import { AlarmClock, CalendarClock, IndianRupee, Loader2, Percent, Trophy, Wallet } from 'lucide-react'
import type { PipelineReport } from '@/lib/pipeline/rules'
import type { DateRange } from '@/lib/salon/ranges'
import { DateRangeFilter } from '../salon/date-range'
import { api, card, StatTile } from '../salon/ui'
import { money, selectInput, type PipelineData } from './shared'

function Bars({ rows, currency }: { rows: { label: string; count: number; value: number }[]; currency: string }) {
  const top = Math.max(1, ...rows.map((r) => r.value || r.count))
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="font-semibold text-[#0E1B3D] dark:text-white truncate">{row.label}</span>
            <span className="shrink-0 text-[#4a5672] dark:text-slate-300 tabular-nums"><span className="font-bold text-[#0E1B3D] dark:text-white">{money(row.value, currency, true)}</span> · {row.count}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-[#eef1f6] dark:bg-slate-800 overflow-hidden">
            <div className="h-full rounded-full bg-[#1D5BEA]" style={{ width: `${Math.max(row.value || row.count ? 3 : 0, Math.round(((row.value || row.count) / top) * 100))}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

const th = 'px-3 py-2.5 text-[12.5px] font-bold uppercase tracking-wide text-[#6B7894] whitespace-nowrap'
const td = 'px-3 py-2.5 text-[14px] text-[#0E1B3D] dark:text-slate-200 whitespace-nowrap tabular-nums'

export function PipelineReports({ data, range, onRangeChange }: { data: PipelineData; range: DateRange; onRangeChange: (range: DateRange) => void }) {
  const { orgId, team, currency, me } = data
  const [owner, setOwner] = useState('')
  const [report, setReport] = useState<PipelineReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setLoading(true)
    const params = new URLSearchParams({ organizationId: orgId, preset: range.preset, from: range.from, to: range.to })
    if (owner) params.set('owner', owner)
    api(`/api/pipeline/report?${params}`)
      .then((result) => { if (live) { setReport(result.report); setError('') } })
      .catch((err) => { if (live) setError(err.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [orgId, range.preset, range.from, range.to, owner])

  const MoneyIcon = currency === 'INR' ? IndianRupee : Wallet

  return (
    <div className="space-y-4">
      <div className="flex flex-col @4xl:flex-row gap-3">
        <div className="flex-1 min-w-0"><DateRangeFilter value={range} onChange={onRangeChange} loading={loading} /></div>
        {me.seeAll && (
          <div className={`${card} px-3 py-3 @4xl:w-[240px] flex items-center`}>
            <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Whose deals" className={selectInput}>
              <option value="">Everyone</option><option value="none">No owner</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
            </select>
          </div>
        )}
      </div>

      {error && <div className={`${card} p-4 text-[15px] text-[#b91c1c]`}>{error}</div>}
      {!report && loading && <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-[#1D5BEA]" size={28} /></div>}

      {report && (
        <div className={`space-y-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 @4xl:grid-cols-3 gap-2.5 @xl:gap-3">
            <StatTile label="Open pipeline" value={money(report.open.value, currency, true)} hint={`${report.open.count} open deal${report.open.count === 1 ? '' : 's'}`} icon={<MoneyIcon />} />
            <StatTile label="Won" value={money(report.won.value, currency, true)} hint={`${report.won.count} deal${report.won.count === 1 ? '' : 's'} · ${report.created} new`} icon={<Trophy />} />
            <StatTile label="Win rate" value={report.winRate == null ? '—' : `${report.winRate}%`} hint={`${report.won.count} won · ${report.lost} lost`} icon={<Percent />} />
            <StatTile label="Average deal" value={report.averageDeal == null ? '—' : money(report.averageDeal, currency, true)} hint="Of deals won" icon={<Wallet />} />
            <StatTile label="Days to close" value={report.averageDaysToClose == null ? '—' : report.averageDaysToClose} hint="Average, won deals" icon={<CalendarClock />} />
            <StatTile label="Follow-ups due" value={<span className={report.followUps.overdue ? 'text-[#b91c1c]' : ''}>{report.followUps.overdue + report.followUps.today}</span>} hint={`${report.followUps.overdue} overdue · ${report.followUps.today} today`} icon={<AlarmClock />} />
          </div>

          <div className="grid grid-cols-1 @4xl:grid-cols-2 gap-4">
            <section className={`${card} p-4 @xl:p-5`}>
              <h3 className="text-[16px] font-extrabold text-[#0E1B3D] dark:text-white">Open deals by stage</h3>
              <p className="text-[13px] text-[#6B7894] mb-4">Value and number of deals, right now</p>
              {report.byStage.length ? <Bars rows={report.byStage.map((s) => ({ label: s.name, count: s.count, value: s.value }))} currency={currency} /> : <p className="text-[14px] text-[#6B7894]">No stages yet.</p>}
            </section>
            <section className={`${card} p-4 @xl:p-5`}>
              <h3 className="text-[16px] font-extrabold text-[#0E1B3D] dark:text-white">Why deals were lost</h3>
              <p className="text-[13px] text-[#6B7894] mb-4">In these dates</p>
              {report.lostReasons.length ? (
                <ul className="space-y-3">
                  {report.lostReasons.map((r) => {
                    const top = report.lostReasons[0].count
                    return (
                      <li key={r.reason}>
                        <div className="flex justify-between gap-3 text-[14px]"><span className="font-semibold text-[#0E1B3D] dark:text-white truncate">{r.reason}</span><span className="font-bold text-[#0E1B3D] dark:text-white tabular-nums">{r.count}</span></div>
                        <div className="mt-1 h-2 rounded-full bg-[#eef1f6] dark:bg-slate-800 overflow-hidden"><div className="h-full rounded-full bg-[#8a94a8]" style={{ width: `${Math.round((r.count / top) * 100)}%` }} /></div>
                      </li>
                    )
                  })}
                </ul>
              ) : <p className="text-[14px] text-[#6B7894]">No deals lost in these dates.</p>}
            </section>
          </div>

          <section className={`${card} overflow-hidden`}>
            <div className="px-4 @xl:px-5 pt-4 @xl:pt-5 pb-2">
              <h3 className="text-[16px] font-extrabold text-[#0E1B3D] dark:text-white">Where deals come from</h3>
              <p className="text-[13px] text-[#6B7894]">New deals and deals won in these dates</p>
            </div>
            {report.bySource.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[420px]">
                  <thead><tr className="border-b border-[#eef1f6] dark:border-slate-800"><th className={`${th} pl-4 @xl:pl-5`}>Source</th><th className={`${th} text-right`}>New</th><th className={`${th} text-right`}>Won</th><th className={`${th} text-right pr-4 @xl:pr-5`}>Won value</th></tr></thead>
                  <tbody>
                    {report.bySource.map((s) => (
                      <tr key={s.source} className="border-b last:border-0 border-[#eef1f6] dark:border-slate-800">
                        <td className={`${td} pl-4 @xl:pl-5 font-semibold`}>{s.label}</td><td className={`${td} text-right`}>{s.created}</td><td className={`${td} text-right`}>{s.won}</td><td className={`${td} text-right pr-4 @xl:pr-5 font-bold`}>{money(s.wonValue, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="px-4 @xl:px-5 pb-5 text-[14px] text-[#6B7894]">No new or won deals in these dates.</p>}
          </section>

          {me.seeAll && (
            <section className={`${card} overflow-hidden`}>
              <div className="px-4 @xl:px-5 pt-4 @xl:pt-5 pb-2">
                <h3 className="text-[16px] font-extrabold text-[#0E1B3D] dark:text-white">Team</h3>
                <p className="text-[13px] text-[#6B7894]">Open deals now; won and lost in these dates</p>
              </div>
              {report.byOwner.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[560px]">
                    <thead><tr className="border-b border-[#eef1f6] dark:border-slate-800"><th className={`${th} pl-4 @xl:pl-5`}>Person</th><th className={`${th} text-right`}>Open</th><th className={`${th} text-right`}>Open value</th><th className={`${th} text-right`}>Won</th><th className={`${th} text-right`}>Won value</th><th className={`${th} text-right pr-4 @xl:pr-5`}>Win rate</th></tr></thead>
                    <tbody>
                      {report.byOwner.map((o) => (
                        <tr key={o.id || 'none'} className="border-b last:border-0 border-[#eef1f6] dark:border-slate-800">
                          <td className={`${td} pl-4 @xl:pl-5 font-semibold max-w-[200px] truncate`}>{o.name}</td><td className={`${td} text-right`}>{o.open}</td><td className={`${td} text-right`}>{money(o.openValue, currency, true)}</td>
                          <td className={`${td} text-right`}>{o.won}</td><td className={`${td} text-right font-bold`}>{money(o.wonValue, currency, true)}</td><td className={`${td} text-right pr-4 @xl:pr-5`}>{o.winRate == null ? '—' : `${o.winRate}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="px-4 @xl:px-5 pb-5 text-[14px] text-[#6B7894]">No deals yet.</p>}
            </section>
          )}
        </div>
      )}
    </div>
  )
}

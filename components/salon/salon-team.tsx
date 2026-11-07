'use client'

/** Team: how each person is doing — services, value, commission, ratings — and unhappy customers to call. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { BadgePercent, Check, ChevronRight, IndianRupee, Loader2, Phone, Scissors, Star, Users } from 'lucide-react'
import { formatRupees } from '@/lib/salon/invoice'
import { rangeQuery, type DateRange } from '@/lib/salon/ranges'
import { formatIstDay, istDate } from '@/lib/salon/spoken'
import { DateRangeFilter } from './date-range'
import { api, Avatar, card, StatTile } from './ui'

type Flash = (tone: 'success' | 'error', text: string) => void

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={size} className={n <= Math.round(rating) ? 'fill-[#f59e0b] text-[#f59e0b]' : 'text-[#d5ddeb] dark:text-slate-700'} />)}
    </span>
  )
}

export function SalonTeam({ orgId, flash, range, onRangeChange, onOpenReviews }: { orgId: string; flash: Flash; range: DateRange; onRangeChange: (range: DateRange) => void; onOpenReviews?: () => void }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const latest = useRef(0)

  const load = useCallback(async () => {
    // Only the newest request counts when the dates change quickly
    const request = ++latest.current
    setLoading(true)
    try {
      const result = await api(`/api/salon/performance?organizationId=${orgId}&${rangeQuery(range)}`)
      if (request === latest.current) setData(result)
    } catch (err: any) {
      if (request === latest.current) flash('error', err.message)
    } finally {
      if (request === latest.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, range])

  useEffect(() => { load() }, [load])

  async function called(id: string) {
    setBusyId(id)
    try {
      await api('/api/salon/feedback', { method: 'PATCH', body: JSON.stringify({ organizationId: orgId, id }) })
      setData((current: any) => ({ ...current, toCall: current.toCall.filter((f: any) => f.id !== id) }))
      flash('success', 'Marked as called.')
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusyId(null)
    }
  }

  const totals = data?.totals
  const best = Math.max(1, ...(data?.staff || []).map((row: any) => row.revenue))
  const today = istDate()

  return (
    <div className="space-y-5">
      <DateRangeFilter value={range} onChange={onRangeChange} loading={loading} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <StatTile label="Services value" value={totals ? formatRupees(totals.revenue) : '…'} icon={<IndianRupee size={20} />} tone="green" hint="Before GST, after discounts" />
        <StatTile label="Services done" value={totals ? totals.services : '…'} icon={<Scissors size={20} />} tone="blue" hint={totals ? `${totals.visits} visit${totals.visits === 1 ? '' : 's'}` : undefined} />
        <StatTile label="Commission" value={totals ? formatRupees(totals.commission) : '…'} icon={<BadgePercent size={20} />} tone="pink" hint="To pay the team" />
        <StatTile label="Rating" value={totals?.averageRating ? `${totals.averageRating} ★` : '–'} icon={<Star size={20} />} tone="amber" hint={totals ? `${totals.ratings} rating${totals.ratings === 1 ? '' : 's'}` : undefined} />
      </div>

      {data?.toCall?.length > 0 && (
        <section className={`${card} overflow-hidden border-[#f3c7c7] dark:border-red-900/60`}>
          <div className="px-4 sm:px-5 py-3.5 bg-[#fdf0f0] dark:bg-red-950/20 border-b border-[#f3d4d4] dark:border-red-900/40">
            <h2 className="text-[16px] font-extrabold text-[#0E1B3D] dark:text-white flex items-center gap-2"><Phone size={17} className="text-[#b91c1c]" /> Unhappy customers to call <span className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-[#b91c1c] text-white text-[12.5px] font-bold">{data.toCall.length}</span></h2>
          </div>
          <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
            {data.toCall.map((f: any) => (
              <li key={f.id} className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[15.5px] font-bold text-[#0E1B3D] dark:text-white">{f.customer_name || 'Customer'} {f.customer_phone && <a href={`tel:${f.customer_phone}`} className="ml-1 text-[14px] font-semibold text-[#1D5BEA] hover:underline">{f.customer_phone}</a>}</p>
                  <p className="text-[13.5px] text-[#6B7894] flex items-center gap-2"><Stars rating={f.rating} /> {formatIstDay(istDate(f.created_at), today)}{f.staff_names?.length ? ` · served by ${f.staff_names.join(', ')}` : ''}</p>
                  {(f.tags?.length > 0 || f.comment) && <p className="mt-1 text-[14px] text-[#0E1B3D] dark:text-slate-200">{f.tags?.length > 0 && <span className="font-semibold text-[#b91c1c] dark:text-red-300">{f.tags.join(', ')}{f.comment ? ' · ' : ''}</span>}{f.comment && `“${f.comment}”`}</p>}
                </div>
                <button type="button" disabled={busyId === f.id} onClick={() => called(f.id)} className="self-start sm:self-auto inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[14.5px] font-semibold text-[#0E1B3D] dark:text-white hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50">{busyId === f.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Called</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card}>
        <div className="px-4 sm:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-center gap-2"><Users size={19} className="text-[#1D5BEA]" /><h2 className="text-[18px] font-extrabold text-[#0E1B3D] dark:text-white">Team performance</h2></div>
        {loading && !data ? <div className="flex justify-center py-14"><Loader2 className="animate-spin text-[#1D5BEA]" /></div>
          : !data?.staff?.length ? <p className="px-5 py-12 text-center text-[15px] text-[#6B7894]">Add your team in Setup, then bill services with who did them. Their numbers show here.</p>
          : (
            <ul className={`divide-y divide-[#eef1f6] dark:divide-slate-800 ${loading ? 'opacity-60' : ''}`}>
              {data.staff.map((row: any) => (
                <li key={row.id || row.name} className="px-4 sm:px-5 py-4">
                  <div className="flex items-center gap-3">
                    {row.id ? <Avatar name={row.name} size={44} /> : <span className="h-11 w-11 rounded-full bg-[#eef1f6] dark:bg-slate-800 text-[#8a94a8] flex items-center justify-center text-[13px] font-bold">?</span>}
                    <div className="min-w-0 flex-1">
                      <p className="text-[16.5px] font-bold text-[#0E1B3D] dark:text-white flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="truncate">{row.name}</span>{row.commissionPercent > 0 && <span className="inline-flex items-center h-6 px-2 rounded-md bg-[#fdeef6] dark:bg-pink-950/40 text-[#be185d] dark:text-pink-300 text-[12px] font-bold">{row.commissionPercent}%</span>}</p>
                      <p className="text-[13.5px] text-[#6B7894] flex flex-wrap items-center gap-x-2">
                        <span>{row.services} service{row.services === 1 ? '' : 's'} · {row.visits} visit{row.visits === 1 ? '' : 's'}</span>
                        {row.averageRating ? <span className="inline-flex items-center gap-1"><Stars rating={row.averageRating} size={13} /> {row.averageRating} ({row.ratings})</span> : <span className="text-[#a3adc2]">No ratings yet</span>}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[18px] font-extrabold text-[#0E1B3D] dark:text-white">{formatRupees(row.revenue)}</p>
                      {row.commissionPercent > 0 && <p className="text-[13px] font-bold text-[#be185d] dark:text-pink-300">Earned {formatRupees(row.commission)}</p>}
                    </div>
                  </div>
                  <div className="mt-2.5 ml-14 h-2 rounded-full bg-[#eef1f6] dark:bg-slate-800 overflow-hidden" aria-hidden><div className="h-full rounded-full bg-[#1D5BEA]" style={{ width: `${Math.round((row.revenue / best) * 100)}%` }} /></div>
                  {row.topServices.length > 0 && (
                    <div className="mt-2 ml-14 flex flex-wrap gap-1.5">
                      {row.topServices.map((s: any) => <span key={s.name} className="inline-flex items-center h-6 px-2 rounded-md bg-[#f4f6fa] dark:bg-slate-800 text-[12px] font-semibold text-[#4a5672] dark:text-slate-300">{s.name} × {s.count}</span>)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>

      {data?.recentFeedback?.length > 0 && (
        <section className={card}>
          <div className="px-4 sm:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-center gap-2"><Star size={19} className="text-[#f59e0b]" /><h2 className="text-[18px] font-extrabold text-[#0E1B3D] dark:text-white">Latest feedback</h2>
            {onOpenReviews && <button type="button" onClick={onOpenReviews} className="ml-auto inline-flex items-center gap-1 h-9 px-3 rounded-xl text-[14px] font-semibold text-[#1D5BEA] hover:bg-[#eef3fe] dark:hover:bg-blue-950/40 cursor-pointer">All reviews <ChevronRight size={16} /></button>}
          </div>
          <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
            {data.recentFeedback.map((f: any) => (
              <li key={f.id} className="px-4 sm:px-5 py-3">
                <div className="flex items-center gap-3">
                  <Stars rating={f.rating} />
                  <p className="min-w-0 flex-1 text-[14.5px] text-[#0E1B3D] dark:text-white truncate">{f.customer_name || 'Customer'}<span className="text-[#6B7894]">{f.staff_names?.length ? ` · ${f.staff_names.join(', ')}` : ''}</span></p>
                  <span className="text-[13px] text-[#8a94a8] shrink-0">{formatIstDay(istDate(f.created_at), today)}</span>
                </div>
                {(f.tags?.length > 0 || f.comment) && (
                  <p className="mt-1 text-[13.5px] text-[#4a5672] dark:text-slate-300">{f.tags?.length > 0 && <span className="font-semibold">{f.tags.join(', ')}</span>}{f.tags?.length > 0 && f.comment ? ' · ' : ''}{f.comment && <span className="italic">“{f.comment}”</span>}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

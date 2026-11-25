'use client'

import { useEffect, useState } from 'react'
import { BarChart3, Eye, IndianRupee, Loader2, Package, ShoppingCart, Users } from 'lucide-react'
import { formatMoney } from '@/lib/commerce/commerce-utils'
import { formatMoney as moneyFormat } from '@/lib/pipeline/rules'
import { CHANNEL_LABELS, REPORT_CHANNELS, REPORT_PERIODS, type ReportChannel, type ShopReport } from '@/lib/commerce/shop-reports'
import { showPhone } from '@/lib/phone-display'
import { Metric, cardClass, hintClass, sectionTitle } from './ui'

const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })
const periodName = (d: number) => (d === 1 ? 'Today' : `${d} days`)
const beforeName = (d: number) => (d === 1 ? 'the day before' : `the ${d} days before`)
/** Today in India time, "YYYY-MM-DD" (the most a to date can be). */
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

/** "+20% vs the 7 days before" (null when there is nothing to compare with). */
function change(now: number, before: number, days: number): { text: string; down: boolean } | null {
  if (!before && !now) return null
  if (!before) return { text: `New vs ${beforeName(days)}`, down: false }
  const pct = Math.round(((now - before) / before) * 100)
  if (pct === 0) return { text: `Same as ${beforeName(days)}`, down: false }
  return { text: `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs ${beforeName(days)}`, down: pct < 0 }
}

/** A round top for the chart's scale: 4,500 → 5,000; 17,200 → 20,000. */
function niceTop(peak: number): number {
  if (peak <= 0) return 1
  const step = 10 ** Math.floor(Math.log10(peak))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * step >= peak) return m * step
  return 10 * step
}

/** "▲ 18% vs the 30 days before", inside a number tile. */
function ChangeLine({ change }: { change: { text: string; down: boolean } | null }) {
  if (!change) return null
  return <p className={`mt-1 text-[11px] font-semibold leading-snug ${change.down ? 'text-[#b91c1c] dark:text-red-300' : 'text-[#174bc4] dark:text-[#9db5ef]'}`}>{change.text}</p>
}

/** Shop reports: visitors, orders, money received, what sells, carts left, best customers; by period and channel. */
export function ReportsTab({ orgId, currency }: { orgId: string; currency: string }) {
  const [days, setDays] = useState<number>(30)
  // Dates the owner picked (both set = used instead of the ready periods)
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [picking, setPicking] = useState(false)
  const [draft, setDraft] = useState({ from: '', to: '' })
  const [channel, setChannel] = useState<ReportChannel | ''>('')
  const [show, setShow] = useState<'sales' | 'orders'>('sales')
  // The bar being pointed at or tapped (phones have no hover), shown in words above the chart
  const [pointed, setPointed] = useState<number | null>(null)
  const [report, setReport] = useState<ShopReport | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    const period = range ? `from=${range.from}&to=${range.to}` : `days=${days}`
    fetch(`/api/commerce/reports?organizationId=${orgId}&${period}${channel ? `&channel=${channel}` : ''}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Could not load the report.'); return d })
      .then((d) => { if (live) { setReport(d.report); setPointed(null) } })
      .catch((e) => { if (live) setError(e.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [orgId, days, channel, range])

  const money = (n: number) => formatMoney(n, currency)
  const value = (d: ShopReport['daily'][number]) => (show === 'sales' ? d.sales : d.orders)
  const peak = Math.max(1, ...(report?.daily || []).map(value))
  const website = !channel || channel === 'website'
  const channelTotal = (report?.channels || []).reduce((s, c) => s + c.sales, 0)
  const shownDays = report?.daily?.length || days
  const salesChange = report ? change(report.sales, report.before?.sales || 0, shownDays) : null
  const ordersChange = report ? change(report.orders, report.before?.orders || 0, shownDays) : null
  const endsToday = !report?.to || report.to === istToday()
  const draftProblem = !draft.from || !draft.to ? '' : draft.from > draft.to ? 'The from date must be on or before the to date.' : ''
  const applyDates = () => {
    if (!draft.from || !draft.to || draftProblem) return
    setRange({ ...draft })
    setPicking(false)
  }
  const chip = (active: boolean) => `shrink-0 h-8 max-sm:h-10 px-3 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap ${active ? 'bg-[#1D5BEA] text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`
  const group = 'inline-flex max-w-full overflow-x-auto p-1 rounded-xl bg-white dark:bg-[#111b21] border border-slate-200 dark:border-slate-800'
  const labelEvery = report ? Math.max(1, Math.ceil(report.daily.length / 7)) : 1
  // The chart's scale: a round top value, its half, and 0 (the bars had no numbers beside them)
  const axisTop = show === 'orders' ? Math.max(2, Math.ceil(peak / 2) * 2) : niceTop(peak)
  const axisLabel = (n: number) => (show === 'orders' ? n.toLocaleString('en-IN') : moneyFormat(n, currency, true))
  const dayRows = report?.daily || []
  const shownDay = dayRows.length ? dayRows[pointed ?? dayRows.length - 1] : null
  const dayName = (i: number) => (i === dayRows.length - 1 && endsToday ? 'Today' : dayLabel(dayRows[i].day))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 size={18} className="text-[#1D5BEA]" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Shop reports</h2>
          {loading && <Loader2 size={14} className="animate-spin text-slate-400" />}
        </div>
        <div className="flex flex-wrap gap-2 min-w-0 max-w-full">
          <div role="group" aria-label="Period" className={group}>
            {REPORT_PERIODS.map((d) => (
              <button key={d} type="button" onClick={() => { setDays(d); setRange(null); setPicking(false) }} aria-pressed={!range && days === d} className={chip(!range && days === d)}>{periodName(d)}</button>
            ))}
            <button type="button" onClick={() => { setDraft(range || { from: '', to: istToday() }); setPicking((p) => !p) }} aria-pressed={Boolean(range)} aria-expanded={picking} className={chip(Boolean(range))}>
              {range ? `${dayLabel(range.from)} – ${dayLabel(range.to)}` : 'Pick dates'}
            </button>
          </div>
          <div role="group" aria-label="Where orders came from" className={group}>
            <button type="button" onClick={() => setChannel('')} aria-pressed={!channel} className={chip(!channel)}>All</button>
            {REPORT_CHANNELS.map((c) => (
              <button key={c} type="button" onClick={() => setChannel(c)} aria-pressed={channel === c} className={chip(channel === c)}>{CHANNEL_LABELS[c]}</button>
            ))}
          </div>
        </div>
      </div>

      {picking && (
        <div className={`${cardClass} p-4 flex flex-wrap items-end gap-3`}>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            From
            <input type="date" value={draft.from} max={draft.to || istToday()} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} className="mt-1 block h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111b21] px-3 text-sm text-slate-900 dark:text-white" />
          </label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            To
            <input type="date" value={draft.to} min={draft.from || undefined} max={istToday()} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} className="mt-1 block h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111b21] px-3 text-sm text-slate-900 dark:text-white" />
          </label>
          <button type="button" onClick={applyDates} disabled={!draft.from || !draft.to || Boolean(draftProblem)} className="h-10 px-4 rounded-lg bg-[#1D5BEA] hover:bg-[#174bc4] disabled:opacity-50 text-white text-sm font-bold cursor-pointer">Show report</button>
          {range && <button type="button" onClick={() => { setRange(null); setPicking(false) }} className="h-10 px-3 rounded-lg text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">Clear dates</button>}
          {draftProblem && <p role="alert" className="w-full text-xs text-[#b91c1c]">{draftProblem}</p>}
          <p className="w-full text-[11px] text-slate-500">Up to 366 days. Compared with the same number of days just before.</p>
        </div>
      )}

      {error && <p role="alert" className="p-3 rounded-xl bg-[#fdf0f0] text-[#b91c1c] text-sm">{error}</p>}

      {report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label="Sales" value={money(report.sales)} note={`${money(report.received ?? 0)} received · ${money(Math.max(0, report.sales - (report.received ?? 0)))} to collect`} icon={IndianRupee} extra={<ChangeLine change={salesChange} />} />
            <Metric label="Orders" value={report.orders.toLocaleString('en-IN')} note={`${report.orders ? `About ${money(Math.round(report.averageOrder))} each` : 'No orders yet'}${report.cancelled ? ` · ${report.cancelled} cancelled` : ''}`} icon={Package} extra={<ChangeLine change={ordersChange} />} />
            {website ? (
              <Metric label="Store visits" value={report.visits.toLocaleString('en-IN')} note={report.conversion === null ? 'Counted when people open your store page' : `${Math.round(report.conversion)}% of visits ordered`} icon={Eye} tone="text-[#1D5BEA]" />
            ) : (
              <Metric label="Received" value={money(report.received ?? 0)} note="Paid orders in this period" icon={IndianRupee} tone="text-[#1D5BEA]" />
            )}
            <Metric label="Customers" value={(report.newCustomers + report.returningCustomers).toLocaleString('en-IN')} note={`${report.newCustomers} new · ${report.returningCustomers} returning${report.repeatCustomers ? ` · ${report.repeatCustomers} ordered again` : ''}`} icon={Users} tone="text-[#1D5BEA]" />
          </div>

          <section className={`${cardClass} p-4 sm:p-5`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className={sectionTitle}>{show === 'sales' ? 'Sales' : 'Orders'} each day</h3>
              <div role="group" aria-label="Show" className="inline-flex shrink-0 p-0.5 rounded-lg bg-[#eef1f6] dark:bg-slate-800">
                {(['sales', 'orders'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setShow(s)} aria-pressed={show === s} className={`h-7 max-sm:h-9 px-2.5 rounded-md text-xs font-bold cursor-pointer ${show === s ? 'bg-white dark:bg-[#111b21] text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>{s === 'sales' ? 'Sales' : 'Orders'}</button>
                ))}
              </div>
            </div>
            {report.daily.length === 1 ? (
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{endsToday ? 'Today' : dayLabel(report.daily[0].day)}: <b>{money(report.daily[0]?.sales || 0)}</b> from <b>{report.daily[0]?.orders || 0}</b> {report.daily[0]?.orders === 1 ? 'order' : 'orders'}{website ? <> · <b>{report.daily[0]?.visits || 0}</b> visits</> : null}.</p>
            ) : (
              <>
                {/* The day pointed at or tapped (the latest day otherwise) */}
                {shownDay && (
                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 tabular-nums" aria-live="polite">
                    <span className="font-semibold text-slate-900 dark:text-white">{dayName(pointed ?? dayRows.length - 1)}</span>: {money(shownDay.sales)} · {shownDay.orders} {shownDay.orders === 1 ? 'order' : 'orders'}{website ? ` · ${shownDay.visits} visits` : ''}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  {/* Scale */}
                  <div className="w-11 shrink-0 h-36 flex flex-col justify-between items-end text-[10px] leading-none text-slate-400 tabular-nums" aria-hidden="true">
                    <span className="-mt-[5px]">{axisLabel(axisTop)}</span>
                    <span>{axisLabel(axisTop / 2)}</span>
                    <span className="-mb-[5px]">0</span>
                  </div>
                  <div className="relative flex-1 min-w-0">
                    <div className="absolute inset-x-0 top-0 h-36 flex flex-col justify-between pointer-events-none" aria-hidden="true">
                      <div className="border-t border-dashed border-[#e3e8f2] dark:border-slate-800" />
                      <div className="border-t border-dashed border-[#e3e8f2] dark:border-slate-800" />
                      <div className="border-t border-[#d5ddeb] dark:border-slate-700" />
                    </div>
                    <div className="relative flex items-end gap-[2px] h-36" role="img" aria-label={`${show === 'sales' ? 'Sales' : 'Orders'} each day, highest ${axisLabel(peak)}`} onMouseLeave={() => setPointed(null)}>
                      {dayRows.map((d, i) => (
                        <button
                          key={d.day}
                          type="button"
                          tabIndex={-1}
                          onClick={() => setPointed(pointed === i ? null : i)}
                          onMouseEnter={() => setPointed(i)}
                          className="relative flex-1 min-w-0 h-full flex items-end cursor-pointer"
                          title={`${dayLabel(d.day)}: ${money(d.sales)} · ${d.orders} orders${website ? ` · ${d.visits} visits` : ''}`}
                        >
                          <span className={`block w-full rounded-t ${value(d) ? (pointed === i ? 'bg-[#0E1B3D] dark:bg-[#9db5ef]' : 'bg-[#1D5BEA]') : 'bg-[#e3e8f2] dark:bg-slate-800'}`} style={{ height: `${value(d) ? Math.max(3, (value(d) / axisTop) * 100) : 2}%` }} />
                        </button>
                      ))}
                    </div>
                    {/* Dates under the bars: placed by position, so none is cut short; every other one hides on small phones */}
                    <div className="relative h-4 mt-1.5 text-[10px] leading-4 text-slate-500 dark:text-slate-400" aria-hidden="true">
                      {dayRows.map((d, i) => {
                        const back = dayRows.length - 1 - i
                        if (back % labelEvery !== 0) return null
                        const last = back === 0
                        const text = last ? (endsToday ? 'Today' : dayLabel(d.day)) : dayRows.length <= 7 ? weekday(d.day) : dayLabel(d.day)
                        return (
                          <span
                            key={d.day}
                            className={`absolute top-0 whitespace-nowrap ${last ? '' : '-translate-x-1/2'} ${(back / labelEvery) % 2 === 1 ? 'max-[420px]:hidden' : ''}`}
                            style={last ? { right: 0 } : { left: `${((i + 0.5) / dayRows.length) * 100}%` }}
                          >
                            {text}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </div>
                <p className={`${hintClass} mt-2 sm:hidden`}>Tap a bar to see that day.</p>
              </>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className={`${cardClass} p-4 sm:p-5`}>
              <h3 className={sectionTitle}>What sells</h3>
              {report.topProducts.length === 0 ? <p className={hintClass}>No orders in this period yet.</p> : (
                <ol className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {report.topProducts.map((p, i) => (
                    <li key={`${p.productId}-${i}`} className="py-2 flex items-center gap-3">
                      <span className="w-5 text-xs text-slate-400 tabular-nums">{i + 1}</span>
                      <span className="flex-1 min-w-0 truncate font-medium text-slate-900 dark:text-white">{p.title}</span>
                      <span className="text-xs text-slate-500 tabular-nums shrink-0 whitespace-nowrap">{p.quantity.toLocaleString('en-IN')} sold</span>
                      <span className="w-20 sm:w-24 text-right font-semibold tabular-nums shrink-0">{money(p.sales)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className={`${cardClass} p-4 sm:p-5`}>
              <h3 className={sectionTitle}>Best customers</h3>
              {report.customers.length === 0 ? <p className={hintClass}>No customers in this period yet.</p> : (
                <ol className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {report.customers.map((c, i) => (
                    <li key={`${c.phone}-${i}`} className="py-2 flex items-center gap-3">
                      <span className="flex-1 min-w-0">
                        <span className="block truncate font-medium text-slate-900 dark:text-white">{c.name}</span>
                        <span className="block text-xs text-slate-500 truncate">{c.phone ? showPhone(c.phone) : 'No phone'}</span>
                      </span>
                      <span className="text-xs text-slate-500 tabular-nums shrink-0 whitespace-nowrap">{c.orders} {c.orders === 1 ? 'order' : 'orders'}</span>
                      <span className="w-20 sm:w-24 text-right font-semibold tabular-nums shrink-0">{money(c.spent)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className={`${cardClass} p-4 sm:p-5`}>
              <h3 className={sectionTitle}>Where orders came from</h3>
              {report.channels.length === 0 ? <p className={hintClass}>No orders in this period yet.</p> : (
                <ul className="space-y-2 text-sm">
                  {report.channels.map((c) => (
                    <li key={c.channel}>
                      <button type="button" onClick={() => setChannel(channel === c.channel ? '' : (c.channel as ReportChannel))} className="w-full text-left cursor-pointer" aria-pressed={channel === c.channel}>
                        <div className="flex justify-between gap-2"><span className={`min-w-0 truncate font-medium ${channel === c.channel ? 'text-[#1D5BEA]' : ''}`}>{c.label}</span><span className="tabular-nums shrink-0 whitespace-nowrap">{c.orders} · {money(c.sales)}</span></div>
                        <div className="mt-1 h-2 rounded-full bg-[#eef1f6] dark:bg-slate-800"><div className="h-2 rounded-full bg-[#1D5BEA]" style={{ width: `${channelTotal ? Math.max(2, (c.sales / channelTotal) * 100) : 0}%` }} /></div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className={`${hintClass} mt-2`}>Tap one to see only its numbers.</p>
            </section>

            {website && (
              <section className={`${cardClass} p-4 sm:p-5`}>
                <h3 className={`${sectionTitle} flex items-center gap-1.5`}><ShoppingCart size={13} /> Carts left at checkout</h3>
                <dl className="grid grid-cols-3 gap-3 text-center">
                  <div><dt className="text-xs text-slate-500">Left</dt><dd className="text-xl font-bold tabular-nums">{report.carts.left}</dd></div>
                  <div><dt className="text-xs text-slate-500">Reminded</dt><dd className="text-xl font-bold tabular-nums">{report.carts.reminded}</dd></div>
                  <div><dt className="text-xs text-slate-500">Came back</dt><dd className="text-xl font-bold tabular-nums">{report.carts.cameBack}</dd></div>
                </dl>
                <p className={`${hintClass} mt-3`}>{report.carts.value > 0 ? `${money(report.carts.value)} still sitting in carts. ` : ''}People who typed their phone at checkout but did not order get one WhatsApp reminder an hour later (Store settings → WhatsApp messages).</p>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  )
}

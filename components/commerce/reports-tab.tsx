'use client'

import { useEffect, useState } from 'react'
import { BarChart3, Eye, IndianRupee, Loader2, Package, ShoppingCart, Users } from 'lucide-react'
import { formatMoney } from '@/lib/commerce/commerce-utils'
import { REPORT_PERIODS, type ShopReport } from '@/lib/commerce/shop-reports'
import { Metric, cardClass, hintClass, sectionTitle } from './ui'

const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Shop reports: visitors, orders, what sells, carts left, best customers. Simple numbers. */
export function ReportsTab({ orgId, currency }: { orgId: string; currency: string }) {
  const [days, setDays] = useState<number>(30)
  const [report, setReport] = useState<ShopReport | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    fetch(`/api/commerce/reports?organizationId=${orgId}&days=${days}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Could not load the report.'); return d })
      .then((d) => { if (live) setReport(d.report) })
      .catch((e) => { if (live) setError(e.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [orgId, days])

  const money = (n: number) => formatMoney(n, currency)
  const peak = Math.max(1, ...(report?.daily || []).map((d) => d.sales))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 size={18} className="text-[#1D5BEA]" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Shop reports</h2>
          {loading && <Loader2 size={14} className="animate-spin text-slate-400" />}
        </div>
        <div role="group" aria-label="Period" className="inline-flex p-1 rounded-xl bg-white dark:bg-[#111b21] border border-slate-200 dark:border-slate-800">
          {REPORT_PERIODS.map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d} className={`h-8 px-3 rounded-lg text-xs font-bold cursor-pointer ${days === d ? 'bg-[#1D5BEA] text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
              Last {d} days
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="p-3 rounded-xl bg-[#fdf0f0] text-[#b91c1c] text-sm">{error}</p>}

      {report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label="Store visits" value={report.visits.toLocaleString('en-IN')} note={report.conversion === null ? 'Counted from today on' : `${report.conversion}% of visits ordered`} icon={Eye} tone="text-[#1D5BEA]" />
            <Metric label="Orders" value={report.orders.toLocaleString('en-IN')} note={report.cancelled ? `${report.cancelled} cancelled (not counted)` : 'No cancelled orders'} icon={Package} tone="text-[#1D5BEA]" />
            <Metric label="Sales" value={money(report.sales)} note={`About ${money(report.averageOrder)} per order`} icon={IndianRupee} tone="text-[#1D5BEA]" />
            <Metric label="Customers" value={(report.newCustomers + report.returningCustomers).toLocaleString('en-IN')} note={`${report.newCustomers} new · ${report.returningCustomers} came back`} icon={Users} tone="text-[#1D5BEA]" />
          </div>

          <section className={`${cardClass} p-4 sm:p-5`}>
            <h3 className={sectionTitle}>Sales each day</h3>
            <div className="mt-2 flex items-end gap-[2px] h-36" role="img" aria-label="Sales each day">
              {report.daily.map((d) => (
                <div key={d.day} className="flex-1 min-w-0 h-full flex items-end" title={`${dayLabel(d.day)}: ${money(d.sales)} · ${d.orders} orders · ${d.visits} visits`}>
                  <div className={`w-full rounded-t ${d.sales ? 'bg-[#1D5BEA]' : 'bg-[#e3e8f2] dark:bg-slate-800'}`} style={{ height: `${d.sales ? Math.max(4, (d.sales / peak) * 100) : 2}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>{dayLabel(report.daily[0].day)}</span><span>Today</span></div>
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
                      <span className="text-xs text-slate-500 tabular-nums shrink-0">{p.quantity} sold</span>
                      <span className="w-24 text-right font-semibold tabular-nums shrink-0">{money(p.sales)}</span>
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
                        <span className="block text-xs text-slate-500 truncate">{c.phone || 'No phone'}</span>
                      </span>
                      <span className="text-xs text-slate-500 tabular-nums shrink-0">{c.orders} {c.orders === 1 ? 'order' : 'orders'}</span>
                      <span className="w-24 text-right font-semibold tabular-nums shrink-0">{money(c.spent)}</span>
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
                      <div className="flex justify-between"><span className="font-medium">{c.label}</span><span className="tabular-nums">{c.orders} · {money(c.sales)}</span></div>
                      <div className="mt-1 h-2 rounded-full bg-[#eef1f6] dark:bg-slate-800"><div className="h-2 rounded-full bg-[#1D5BEA]" style={{ width: `${report.sales ? Math.max(2, (c.sales / report.sales) * 100) : 0}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={`${cardClass} p-4 sm:p-5`}>
              <h3 className={`${sectionTitle} flex items-center gap-1.5`}><ShoppingCart size={13} /> Carts left at checkout</h3>
              <dl className="grid grid-cols-3 gap-3 text-center">
                <div><dt className="text-xs text-slate-500">Left</dt><dd className="text-xl font-bold tabular-nums">{report.carts.left}</dd></div>
                <div><dt className="text-xs text-slate-500">Reminded</dt><dd className="text-xl font-bold tabular-nums">{report.carts.reminded}</dd></div>
                <div><dt className="text-xs text-slate-500">Came back</dt><dd className="text-xl font-bold tabular-nums">{report.carts.cameBack}</dd></div>
              </dl>
              <p className={`${hintClass} mt-3`}>{report.carts.value > 0 ? `${money(report.carts.value)} still sitting in carts. ` : ''}People who typed their phone at checkout but did not order get one WhatsApp reminder an hour later (Store settings → WhatsApp messages).</p>
            </section>
          </div>
        </>
      )}
    </div>
  )
}

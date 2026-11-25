'use client'

/**
 * The Front Desk counter for a business that does not take appointments (Setup → Appointments switched off): one
 * big Quick bill, the day's bills with their totals (paid, sent, cancelled just as on Invoices), and the few visits
 * booked before appointments were switched off, so they can still be billed. Nothing here talks about bookings.
 */

import { useCallback, useEffect, useState } from 'react'
import { Receipt, ReceiptText, Zap } from 'lucide-react'
import { resolveRange, type DateRange } from '@/lib/salon/ranges'
import { formatIstTime, istDate } from '@/lib/salon/spoken'
import { announceFrontDeskBadges } from '@/lib/front-desk-nav'
import { api, card, primaryButton } from './ui'
import { BillSheet, ResultSheet, type BillTarget } from './counter-sheets'
import { SalonInvoices } from './salon-invoices'
import type { Appointment, SalonSetup } from './types'

type Flash = (tone: 'success' | 'error', text: string) => void
type Sheet = { kind: 'bill'; target: BillTarget } | { kind: 'result'; result: any; walkIn: boolean } | null

const OPEN = ['booked', 'arrived', 'in_service']

export function WalkInCounter({ orgId, setup, canWrite, canVoid, flash }: { orgId: string; setup: SalonSetup; canWrite: boolean; canVoid: boolean; flash: Flash }) {
  const [range, setRange] = useState<DateRange>(() => resolveRange('today'))
  const [reload, setReload] = useState(0)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [earlier, setEarlier] = useState<Appointment[]>([])

  // No booking requests to wait on: no badge on the bottom bar
  useEffect(() => { announceFrontDeskBadges({ counter: 0 }) }, [])

  // While the counter is open, feedback questions go out when they are due
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') api('/api/salon/tick', { method: 'POST', body: JSON.stringify({ organizationId: orgId }) }).catch(() => {}) }
    tick()
    const timer = window.setInterval(tick, 120_000)
    return () => window.clearInterval(timer)
  }, [orgId])

  // Visits booked for today before appointments were switched off: kept, and still billable here
  const loadEarlier = useCallback(async () => {
    const data = await api(`/api/salon/appointments?organizationId=${orgId}&date=${istDate()}`)
    setEarlier(((data.appointments || []) as Appointment[]).filter((a) => OPEN.includes(a.status)))
  }, [orgId])
  useEffect(() => { loadEarlier().catch(() => {}) }, [loadEarlier, reload])

  const quickBill = () => setSheet({ kind: 'bill', target: { kind: 'walkin' } })
  function afterBilling(result: any, walkIn: boolean) {
    setSheet({ kind: 'result', result, walkIn })
    // Today's bills again, with the new one
    setRange((current) => (current.preset === 'today' ? current : resolveRange('today')))
    setReload((n) => n + 1)
  }

  return (
    <div className="space-y-4 @xl:space-y-5">
      <div className={`${card} p-4 @xl:p-5 flex flex-col @2xl:flex-row @2xl:items-center gap-3 @xl:gap-4`}>
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="h-11 w-11 shrink-0 rounded-2xl bg-[#f4f6fa] dark:bg-slate-800 text-[#0E1B3D] dark:text-white flex items-center justify-center"><ReceiptText size={21} /></span>
          <div className="min-w-0">
            <h2 className="text-[18px] @xl:text-[19px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">Walk-in bills</h2>
            <p className="text-[13.5px] @xl:text-[14px] text-[#4a5672] dark:text-slate-400">Bill each customer as they come in. The bill goes to them on WhatsApp.</p>
          </div>
        </div>
        {canWrite && (
          <button type="button" onClick={quickBill} className={`${primaryButton} h-12 w-full @2xl:w-auto shrink-0 whitespace-nowrap`}><Zap size={18} /> Quick bill</button>
        )}
      </div>

      {earlier.length > 0 && (
        <section className={card} aria-labelledby="earlier-visits">
          <div className="px-4 @xl:px-5 pt-4 pb-2">
            <h3 id="earlier-visits" className="text-[15.5px] font-extrabold text-[#0E1B3D] dark:text-white">Booked earlier for today</h3>
            <p className="text-[13px] text-[#6B7894] dark:text-slate-400">Made before appointments were switched off. Bill them when they come.</p>
          </div>
          <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
            {earlier.map((visit) => (
              <li key={visit.id} className="flex items-center gap-3 px-4 @xl:px-5 py-3 min-w-0">
                <span className="w-16 shrink-0 text-[14.5px] font-extrabold text-[#0E1B3D] dark:text-white">{formatIstTime(visit.starts_at)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-[#0E1B3D] dark:text-white truncate">{visit.customer_name}</span>
                  <span className="block text-[13px] text-[#6B7894] truncate">{visit.services.map((s) => s.name).join(', ')}</span>
                </span>
                {canWrite && (
                  <button type="button" onClick={() => setSheet({ kind: 'bill', target: { kind: 'appointment', appointment: visit } })}
                    className="shrink-0 inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-[#d5ddeb] dark:border-slate-700 text-[14px] font-bold text-[#0E1B3D] dark:text-white hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer">
                    <Receipt size={16} /> Bill
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <SalonInvoices orgId={orgId} canWrite={canWrite} canVoid={canVoid} flash={flash} range={range} onRangeChange={setRange} reloadKey={reload} />

      {sheet?.kind === 'bill' && <BillSheet orgId={orgId} setup={setup} target={sheet.target} onClose={() => setSheet(null)} onBilled={(result) => afterBilling(result, sheet.target.kind === 'walkin')} />}
      {sheet?.kind === 'result' && <ResultSheet result={sheet.result} onClose={() => setSheet(null)} onCopied={() => flash('success', 'Link copied')} onNext={sheet.walkIn && canWrite ? quickBill : undefined} />}
    </div>
  )
}

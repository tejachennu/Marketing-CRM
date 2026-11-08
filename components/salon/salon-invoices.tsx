'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ban, CircleCheck, Clock, Copy, ExternalLink, Loader2, MessageCircle, MoreHorizontal, ReceiptText, Search, Wallet } from 'lucide-react'
import { useConfirm } from '@/lib/dialog-context'
import { formatRupees } from '@/lib/salon/invoice'
import { rangeQuery, type DateRange } from '@/lib/salon/ranges'
import { formatIstDay, formatIstTime, istDate } from '@/lib/salon/spoken'
import { DateRangeFilter } from './date-range'
import { api, Avatar, card, StatTile } from './ui'
import type { Invoice } from './types'

type Flash = (tone: 'success' | 'error', text: string) => void
const PAYMENT_LABELS: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card' }
type Filter = 'all' | 'paid' | 'unpaid' | 'void'
const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'paid', label: 'Paid' }, { id: 'unpaid', label: 'Not paid' }, { id: 'void', label: 'Void' }]
const menuItem = 'w-full flex items-center gap-2.5 text-left px-3 py-2.5 rounded-xl text-[15px] font-medium text-[#0E1B3D] dark:text-white hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer'

interface Summary { collected: number; billed: number; bills: number; paidCount: number; unpaidCount: number; unpaidAmount: number; voidCount: number }

export function SalonInvoices({ orgId, canWrite, canVoid, flash, range, onRangeChange }: { orgId: string; canWrite: boolean; canVoid: boolean; flash: Flash; range: DateRange; onRangeChange: (range: DateRange) => void }) {
  const confirm = useConfirm()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [more, setMore] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const latest = useRef(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    // Only the newest request counts when the dates change quickly
    const request = ++latest.current
    setLoading(true)
    try {
      const data = await api(`/api/salon/invoices?organizationId=${orgId}&${rangeQuery(range)}`)
      if (request !== latest.current) return
      setInvoices(data.invoices || [])
      setSummary(data.summary || null)
      setMore(data.more || 0)
      setLoaded(true)
    } finally {
      if (request === latest.current) setLoading(false)
    }
  }, [orgId, range])

  useEffect(() => {
    load().catch((err) => flash('error', err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  useEffect(() => {
    if (!menuFor) return
    const close = () => setMenuFor(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuFor])

  async function act(invoice: Invoice, action: Record<string, unknown>) {
    setBusyId(invoice.id)
    setMenuFor(null)
    try {
      const result = await api('/api/salon/act', { method: 'POST', body: JSON.stringify({ organizationId: orgId, action: { ...action, invoice_id: invoice.id } }) })
      if (result.whatsapp && !result.whatsapp.sent) flash('error', result.whatsapp.windowClosed ? 'Not sent: this customer has not messaged you in the last 24 hours. Copy the link and share it instead.' : result.whatsapp.error)
      else flash('success', result.message)
      await load()
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusyId(null)
    }
  }

  const link = (invoice: Invoice) => `${window.location.origin}/i/${invoice.public_token}`
  const today = istDate()

  // From the totals, so they cover the whole range even when the list is cut short
  const counts = useMemo(() => summary ? {
    all: summary.paidCount + summary.unpaidCount + summary.voidCount,
    paid: summary.paidCount,
    unpaid: summary.unpaidCount,
    void: summary.voidCount,
  } : { all: invoices.length, paid: 0, unpaid: 0, void: 0 }, [summary, invoices])

  // Filtered, then grouped by day (newest first, as the server sends them)
  const days = useMemo(() => {
    const words = query.trim().toLowerCase()
    const digits = words.replace(/\D/g, '')
    const shown = invoices.filter((invoice) => (filter === 'all' || invoice.status === filter) && (!words
      || invoice.customer_name.toLowerCase().includes(words) || invoice.number.toLowerCase().includes(words)
      || (digits.length >= 3 && String(invoice.customer_phone || '').replace(/\D/g, '').includes(digits))))
    const groups: { day: string; invoices: Invoice[]; total: number }[] = []
    for (const invoice of shown) {
      const day = istDate(invoice.issued_at)
      let group = groups.find((g) => g.day === day)
      if (!group) { group = { day, invoices: [], total: 0 }; groups.push(group) }
      group.invoices.push(invoice)
      if (invoice.status !== 'void') group.total += Number(invoice.total) || 0
    }
    return groups
  }, [invoices, filter, query])

  return (
    <div className="space-y-5">
      <DateRangeFilter value={range} onChange={onRangeChange} loading={loading} />

      <div className="grid grid-cols-2 @xl:grid-cols-3 gap-2.5 @xl:gap-3 [&>*:last-child]:col-span-2 @xl:[&>*:last-child]:col-span-1">
        <StatTile label="Collected" value={summary ? formatRupees(summary.collected) : '…'} icon={<Wallet size={20} />} tone="green" hint={summary ? `${summary.paidCount} paid bill${summary.paidCount === 1 ? '' : 's'}` : undefined} />
        <StatTile label="Billed" value={summary ? formatRupees(summary.billed) : '…'} icon={<ReceiptText size={20} />} tone="blue" hint={summary ? `${summary.bills} bill${summary.bills === 1 ? '' : 's'}${summary.voidCount ? `, ${summary.voidCount} void` : ''}` : undefined} />
        <StatTile label="Not paid yet" value={summary ? formatRupees(summary.unpaidAmount) : '…'} icon={<Clock size={20} />} tone="amber" hint={summary ? (summary.unpaidCount ? `${summary.unpaidCount} bill${summary.unpaidCount === 1 ? '' : 's'} to collect` : 'Nothing to collect') : undefined} />
      </div>

      <section className={card}>
        <div className="px-4 @xl:px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex flex-col @4xl:flex-row @4xl:items-center gap-3">
          <h2 className="flex items-center gap-2 text-[18px] font-extrabold text-[#0E1B3D] dark:text-white"><ReceiptText size={19} className="text-[#1D5BEA]" /> Invoices</h2>
          <div className="@4xl:ml-auto flex flex-col @xl:flex-row gap-2">
            <div role="tablist" aria-label="Show" className="grid grid-cols-4 gap-1 rounded-xl bg-[#eef1f6] dark:bg-slate-900 p-1">
              {FILTERS.map(({ id, label }) => (
                <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}
                  className={`h-11 @xl:h-9 min-w-0 px-1 @xl:px-2.5 rounded-lg flex flex-col @xl:flex-row items-center justify-center @xl:gap-1 leading-tight text-[12.5px] @xl:text-[13.5px] font-bold whitespace-nowrap cursor-pointer transition-colors ${filter === id ? 'bg-white dark:bg-[#111b21] text-[#0E1B3D] dark:text-white shadow-sm' : 'text-[#6B7894] dark:text-slate-400 hover:text-[#0E1B3D] dark:hover:text-white'}`}>
                  {label} <span className="text-[11.5px] @xl:text-[13.5px] font-semibold text-[#8a94a8]">{counts[id]}</span>
                </button>
              ))}
            </div>
            <label className="relative block @xl:w-60">
              <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a94a8]" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, number or phone" aria-label="Search invoices"
                className="w-full h-11 pl-9 pr-3 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#0b141a] text-base @xl:text-[14.5px] text-[#0E1B3D] dark:text-white placeholder:text-[#8a94a8] focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/15" />
            </label>
          </div>
        </div>
        {!loaded ? <div className="flex justify-center py-14"><Loader2 className="animate-spin text-[#1D5BEA]" /></div>
          : invoices.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <ReceiptText size={30} className="mx-auto text-[#a3adc2]" />
              <p className="mt-2 text-[15.5px] font-semibold text-[#4a5672] dark:text-slate-300">No bills in these dates</p>
              <p className="text-[14px] text-[#8a94a8]">Choose other dates above, or bill a customer from the Counter.</p>
            </div>
          )
          : days.length === 0 ? <p className="px-5 py-12 text-center text-[15px] text-[#6B7894]">Nothing matches. Try another name, or show all.</p>
          : <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>{days.map((group) => (
            <div key={group.day}>
              <div className="px-4 @xl:px-5 py-2 bg-[#f8fafc] dark:bg-slate-900/50 border-b border-[#eef1f6] dark:border-slate-800 flex items-center justify-between text-[13px] font-bold text-[#6B7894] dark:text-slate-400">
                <span>{formatIstDay(group.day, today)}</span>
                <span>{group.invoices.length} bill{group.invoices.length === 1 ? '' : 's'} · {formatRupees(group.total)}</span>
              </div>
              <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
                {group.invoices.map((invoice) => (
                  <li key={invoice.id} className={`px-4 @xl:px-5 py-3.5 flex items-center gap-3 ${invoice.status === 'void' ? 'opacity-60' : ''}`}>
                    <Avatar name={invoice.customer_name} size={40} className="hidden @xl:inline-flex" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[15.5px] font-bold text-[#0E1B3D] dark:text-white truncate">{invoice.customer_name}</p>
                      <p className="text-[13.5px] text-[#6B7894] truncate">{invoice.number} · {formatIstTime(invoice.issued_at)}{invoice.staff_name ? ` · ${invoice.staff_name}` : ''}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-[16.5px] font-extrabold text-[#0E1B3D] dark:text-white ${invoice.status === 'void' ? 'line-through' : ''}`}>{formatRupees(Number(invoice.total))}</p>
                      <span className={`mt-0.5 inline-flex items-center gap-1 h-6 px-2 rounded-md text-[12.5px] font-bold ${invoice.status === 'paid' ? 'bg-[#e8f7f1] text-[#047857] dark:bg-emerald-950/40 dark:text-emerald-300' : invoice.status === 'void' ? 'bg-[#eef1f6] text-[#6B7894] dark:bg-slate-800 dark:text-slate-400' : 'bg-[#fff4e0] text-[#b45309] dark:bg-amber-950/40 dark:text-amber-300'}`}>
                        {invoice.status === 'paid' ? <CircleCheck size={13} /> : invoice.status === 'void' ? <Ban size={13} /> : <Clock size={13} />}
                        {invoice.status === 'paid' ? <>Paid{PAYMENT_LABELS[invoice.payment_method || ''] && <span className="hidden @xl:inline"> · {PAYMENT_LABELS[invoice.payment_method || '']}</span>}</> : invoice.status === 'void' ? 'Void' : 'Not paid'}
                      </span>
                    </div>
                    <div className="relative shrink-0">
                      <button type="button" aria-label={`More for ${invoice.number}`} onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === invoice.id ? null : invoice.id) }} className="h-10 w-10 @xl:h-11 @xl:w-11 rounded-xl border border-[#e3e8f2] dark:border-slate-700 flex items-center justify-center text-[#4a5672] dark:text-slate-300 hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer">
                        {busyId === invoice.id ? <Loader2 size={18} className="animate-spin" /> : <MoreHorizontal size={20} />}
                      </button>
                      {menuFor === invoice.id && (
                        <div className="absolute right-0 mt-1 z-20 w-64 rounded-2xl border border-[#e3e8f2] dark:border-slate-700 bg-white dark:bg-[#111b21] shadow-xl p-1.5" onClick={(e) => e.stopPropagation()}>
                          <a href={link(invoice)} target="_blank" rel="noopener noreferrer" className={menuItem}><ExternalLink size={16} /> Open bill</a>
                          <button type="button" onClick={() => { navigator.clipboard?.writeText(link(invoice)).then(() => flash('success', 'Link copied')).catch(() => {}); setMenuFor(null) }} className={menuItem}><Copy size={16} /> Copy link</button>
                          {canWrite && invoice.customer_phone && invoice.status !== 'void' && <button type="button" onClick={() => act(invoice, { type: 'send_invoice' })} className={menuItem}><MessageCircle size={16} /> Send on WhatsApp</button>}
                          {canWrite && invoice.status === 'unpaid' && <div className="my-1 border-t border-[#eef1f6] dark:border-slate-800" />}
                          {canWrite && invoice.status === 'unpaid' && (['cash', 'upi', 'card'] as const).map((method) => (
                            <button key={method} type="button" onClick={() => act(invoice, { type: 'pay_invoice', payment_method: method })} className={`${menuItem} text-[#047857] dark:text-emerald-300 hover:bg-[#e8f7f1] dark:hover:bg-emerald-950/30`}><CircleCheck size={16} /> Paid by {PAYMENT_LABELS[method]}</button>
                          ))}
                          {canVoid && invoice.status !== 'void' && <><div className="my-1 border-t border-[#eef1f6] dark:border-slate-800" /><button type="button" onClick={async () => { setMenuFor(null); if (await confirm({ title: `Cancel ${invoice.number}?`, message: 'The invoice stays on record, marked void. This cannot be undone.', confirmLabel: 'Cancel invoice', destructive: true })) act(invoice, { type: 'void_invoice' }) }} className={`${menuItem} text-[#b91c1c] dark:text-red-300 hover:bg-[#fdf0f0] dark:hover:bg-red-950/30`}><Ban size={16} /> Cancel invoice (void)</button></>}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}</div>}
        {loaded && more > 0 && <p className="px-5 py-3.5 border-t border-[#eef1f6] dark:border-slate-800 text-center text-[13.5px] text-[#6B7894]">Showing the latest {invoices.length.toLocaleString('en-IN')} bills. {more.toLocaleString('en-IN')} more in these dates: choose fewer days to see them.</p>}
      </section>
    </div>
  )
}

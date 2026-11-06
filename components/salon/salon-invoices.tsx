'use client'

import { useCallback, useEffect, useState } from 'react'
import { Copy, ExternalLink, Loader2, MessageCircle, MoreHorizontal, ReceiptText } from 'lucide-react'
import { useConfirm } from '@/lib/dialog-context'
import { formatRupees } from '@/lib/salon/invoice'
import { formatIstDay, formatIstTime, istDate } from '@/lib/salon/spoken'
import { api, card } from './ui'
import type { Invoice } from './types'

type Flash = (tone: 'success' | 'error', text: string) => void
const PAYMENT_LABELS: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card' }

export function SalonInvoices({ orgId, canWrite, canVoid, flash }: { orgId: string; canWrite: boolean; canVoid: boolean; flash: Flash }) {
  const confirm = useConfirm()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [summary, setSummary] = useState<{ today: number; month: number; unpaidCount: number; unpaidAmount: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    const data = await api(`/api/salon/invoices?organizationId=${orgId}`)
    setInvoices(data.invoices || [])
    setSummary(data.summary || null)
  }, [orgId])

  useEffect(() => {
    load().catch((err) => flash('error', err.message)).finally(() => setLoading(false))
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

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          ['Collected today', summary ? formatRupees(summary.today) : '…', 'text-[#047857]'],
          ['This month', summary ? formatRupees(summary.month) : '…', 'text-[#0E1B3D] dark:text-white'],
          ['Not paid yet', summary ? `${summary.unpaidCount} · ${formatRupees(summary.unpaidAmount)}` : '…', summary?.unpaidCount ? 'text-[#b45309]' : 'text-[#0E1B3D] dark:text-white'],
        ].map(([label, value, tone]) => (
          <div key={label} className={`${card} px-5 py-4`}>
            <div className="text-[14px] font-semibold text-[#6B7894]">{label}</div>
            <div className={`text-[26px] font-extrabold mt-0.5 ${tone}`}>{value}</div>
          </div>
        ))}
      </div>

      <section className={card}>
        <div className="px-5 py-4 border-b border-[#eef1f6] dark:border-slate-800 flex items-center gap-2"><ReceiptText size={19} className="text-[#1D5BEA]" /><h2 className="text-[18px] font-bold text-[#0E1B3D] dark:text-white">Invoices</h2></div>
        {loading ? <div className="flex justify-center py-14"><Loader2 className="animate-spin text-[#1D5BEA]" /></div>
          : invoices.length === 0 ? <p className="px-5 py-12 text-center text-[15px] text-[#6B7894]">No invoices yet. Bill a customer from the Counter.</p>
          : (
            <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800">
              {invoices.map((invoice) => (
                <li key={invoice.id} className={`px-5 py-3.5 flex items-center gap-3 ${invoice.status === 'void' ? 'opacity-55' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15.5px] font-bold text-[#0E1B3D] dark:text-white truncate">{invoice.customer_name} <span className="font-normal text-[#6B7894]">· {invoice.number}</span></p>
                    <p className="text-[13.5px] text-[#6B7894]">{formatIstDay(istDate(invoice.issued_at), today)}, {formatIstTime(invoice.issued_at)}{invoice.staff_name ? ` · ${invoice.staff_name}` : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[16px] font-extrabold text-[#0E1B3D] dark:text-white">{formatRupees(Number(invoice.total))}</p>
                    <p className={`text-[13px] font-semibold ${invoice.status === 'paid' ? 'text-[#047857]' : invoice.status === 'void' ? 'text-[#b91c1c]' : 'text-[#b45309]'}`}>{invoice.status === 'paid' ? `Paid · ${PAYMENT_LABELS[invoice.payment_method || ''] || ''}` : invoice.status === 'void' ? 'Void' : 'Not paid'}</p>
                  </div>
                  <div className="relative">
                    <button type="button" aria-label={`More for ${invoice.number}`} onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === invoice.id ? null : invoice.id) }} className="h-11 w-11 rounded-xl border border-[#d5ddeb] dark:border-slate-700 flex items-center justify-center text-[#4a5672] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer">
                      {busyId === invoice.id ? <Loader2 size={18} className="animate-spin" /> : <MoreHorizontal size={20} />}
                    </button>
                    {menuFor === invoice.id && (
                      <div className="absolute right-0 mt-1 z-20 w-60 rounded-xl border border-[#e3e8f2] dark:border-slate-700 bg-white dark:bg-[#111b21] shadow-lg py-1" onClick={(e) => e.stopPropagation()}>
                        <a href={link(invoice)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 px-4 py-3 text-[15px] text-[#0E1B3D] dark:text-white hover:bg-[#f6f8fc] dark:hover:bg-slate-800"><ExternalLink size={16} /> Open bill</a>
                        <button type="button" onClick={() => { navigator.clipboard?.writeText(link(invoice)).then(() => flash('success', 'Link copied')).catch(() => {}); setMenuFor(null) }} className="w-full flex items-center gap-2.5 px-4 py-3 text-[15px] text-[#0E1B3D] dark:text-white hover:bg-[#f6f8fc] dark:hover:bg-slate-800 cursor-pointer"><Copy size={16} /> Copy link</button>
                        {canWrite && invoice.customer_phone && invoice.status !== 'void' && <button type="button" onClick={() => act(invoice, { type: 'send_invoice' })} className="w-full flex items-center gap-2.5 px-4 py-3 text-[15px] text-[#0E1B3D] dark:text-white hover:bg-[#f6f8fc] dark:hover:bg-slate-800 cursor-pointer"><MessageCircle size={16} /> Send on WhatsApp</button>}
                        {canWrite && invoice.status === 'unpaid' && (['cash', 'upi', 'card'] as const).map((method) => (
                          <button key={method} type="button" onClick={() => act(invoice, { type: 'pay_invoice', payment_method: method })} className="w-full text-left px-4 py-3 text-[15px] text-[#047857] hover:bg-[#e8f7f1] dark:hover:bg-emerald-950/30 cursor-pointer">Paid by {PAYMENT_LABELS[method]}</button>
                        ))}
                        {canVoid && invoice.status !== 'void' && <button type="button" onClick={async () => { setMenuFor(null); if (await confirm({ title: `Cancel ${invoice.number}?`, message: 'The invoice stays on record, marked void. This cannot be undone.', confirmLabel: 'Cancel invoice', destructive: true })) act(invoice, { type: 'void_invoice' }) }} className="w-full text-left px-4 py-3 text-[15px] text-[#b91c1c] hover:bg-[#fdf0f0] dark:hover:bg-red-950/30 cursor-pointer">Cancel invoice (void)</button>}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  )
}

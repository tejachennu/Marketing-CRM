'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, FileText, Loader2 } from 'lucide-react'
import { secondaryButton, sectionTitle, type ShowToast } from './ui'

interface InvoiceView { number: string; status: string; total: number; issuedAt: string; url: string }

/** Order details → the order's GST invoice: open it, copy its link, or make it now. */
export function OrderInvoice({ orgId, orderId, canEdit, showToast }: { orgId: string; orderId: string; canEdit: boolean; showToast: ShowToast }) {
  const [state, setState] = useState<{ invoice: InvoiceView | null; canIssue: boolean; creditNotes?: { number: string; total: number; url: string }[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/commerce/invoices?organizationId=${orgId}&orderId=${orderId}`)
      .then((r) => r.json())
      .then((d) => { if (live) setState({ invoice: d.invoice || null, canIssue: Boolean(d.canIssue), creditNotes: d.creditNotes || [] }) })
      .catch(() => { if (live) setState({ invoice: null, canIssue: false }) })
    return () => { live = false }
  }, [orgId, orderId])

  async function make() {
    setBusy(true)
    try {
      const res = await fetch('/api/commerce/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, orderId }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not make the invoice.')
      setState({ invoice: data.invoice, canIssue: true })
      window.open(data.invoice.url, '_blank', 'noopener')
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setBusy(false)
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast('error', 'Could not copy. Open the invoice and copy its address.')
    }
  }

  if (!state) return null
  const { invoice } = state
  if (!invoice && !state.canIssue) return null
  return (
    <section>
      <h4 className={sectionTitle}>Invoice</h4>
      {invoice ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 min-w-0">
            <FileText size={14} className="text-[#008069] shrink-0" /> <span className="truncate">{invoice.number}</span>
            {invoice.status === 'cancelled' && <span className="text-xs font-semibold text-[#b91c1c]">Cancelled</span>}
          </p>
          <div className="flex gap-2 ml-auto">
            <a href={invoice.url} target="_blank" rel="noopener noreferrer" className={`${secondaryButton} h-8 px-3`}><ExternalLink size={13} /> Open</a>
            <button type="button" onClick={() => copy(invoice.url)} className={`${secondaryButton} h-8 px-3`}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy link'}</button>
          </div>
        </div>
      ) : null}
      {invoice && (state.creditNotes || []).length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
          {state.creditNotes!.map((n) => <li key={n.number}>Credit note <a href={n.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#008069] hover:underline">{n.number}</a> · − ₹{n.total.toLocaleString('en-IN')}</li>)}
        </ul>
      )}
      {invoice ? null : canEdit ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">Made by itself when the order is shipped or delivered.</p>
          <button type="button" onClick={make} disabled={busy} className={`${secondaryButton} h-8 px-3`}>{busy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Make invoice now</button>
        </div>
      ) : (
        <p className="text-xs text-slate-500">Made when the order is shipped or delivered.</p>
      )}
    </section>
  )
}

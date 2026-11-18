import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { amountInWords } from '@/lib/commerce/invoice'
import { creditNoteByToken, creditNotesFor, invoiceByToken } from '@/lib/commerce/invoice-store'
import { formatRupees } from '@/lib/salon/invoice'
import { PrintButton } from '../../i/[token]/print-button'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Invoice', robots: { index: false, follow: false } }

function formatDate(iso: string) {
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : ''
}

/** A shop order's GST invoice (or plain bill when the shop has no GSTIN): /invoice/<token>, printable on A4. */
export default async function ShopInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const db = getSupabaseAdminClient()
  // The same page shows a credit note (money given back on an invoiced order)
  let invoice: any = await invoiceByToken(db, token).catch(() => null)
  const credit = !invoice
  if (!invoice) invoice = await creditNoteByToken(db, token).catch(() => null)
  if (!invoice) notFound()
  const notes: any[] = credit ? [] : await creditNotesFor(db, invoice.organization_id, invoice.order_id).catch(() => [])

  const business = invoice.business || {}
  const customer = invoice.customer || {}
  const registered = Boolean(invoice.registered)
  const igst = Boolean(invoice.inter_state)
  const cancelled = invoice.status === 'cancelled'
  const lines: any[] = Array.isArray(invoice.lines) ? invoice.lines : []
  const taxRows: any[] = Array.isArray(invoice.tax_summary) ? invoice.tax_summary : []
  const money = (value: unknown) => formatRupees(Number(value) || 0)
  const cell = 'py-2.5 px-3'

  return (
    <main className="min-h-screen bg-[#eef1f6] py-6 sm:py-10 px-3 print:bg-white print:p-0">
      <style>{'@page { size: A4; margin: 14mm } @media print { .no-print { display: none !important } }'}</style>
      <div className="no-print max-w-[820px] mx-auto mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-[#4a5672]">Invoice from <strong className="text-[#0E1B3D]">{business.name || 'the shop'}</strong></p>
        <PrintButton />
      </div>

      <article className="max-w-[820px] mx-auto bg-white text-[#0E1B3D] rounded-2xl shadow-sm print:shadow-none print:rounded-none p-5 sm:p-10">
        <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-5 border-b border-[#e3e8f2] pb-6">
          <div className="flex items-start gap-4 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {business.logo_url && <img src={business.logo_url} alt="" className="h-14 w-auto max-w-[120px] object-contain shrink-0" />}
            <div className="min-w-0">
              <h1 className="text-[22px] font-extrabold leading-tight break-words">{business.name || 'Invoice'}</h1>
              {business.legal_name && business.legal_name !== business.name && <p className="text-[13.5px] text-[#4a5672]">{business.legal_name}</p>}
              {business.address && <p className="text-[13.5px] text-[#4a5672] mt-1 whitespace-pre-line max-w-sm break-words">{business.address}</p>}
              {business.phone && <p className="text-[13.5px] text-[#4a5672] mt-1">{business.phone}</p>}
              {registered && <p className="text-[13.5px] mt-1"><span className="text-[#6B7894]">GSTIN</span> <strong>{business.gstin}</strong>{business.state && <span className="text-[#6B7894]"> · {business.state}</span>}</p>}
            </div>
          </div>
          <div className="sm:text-right shrink-0">
            <p className="text-[13px] font-bold tracking-[0.15em] text-[#1D5BEA]">{credit ? 'CREDIT NOTE' : registered ? 'TAX INVOICE' : 'BILL'}</p>
            <p className="text-[19px] font-extrabold mt-1">{invoice.number}</p>
            <p className="text-[13.5px] text-[#4a5672] mt-1">{formatDate(invoice.issued_at)}</p>
            {credit && invoice.invoice_number && <p className="text-[13.5px] text-[#4a5672]">Against invoice {invoice.invoice_number}</p>}
            {invoice.order_number && <p className="text-[13.5px] text-[#4a5672]">Order #{invoice.order_number}</p>}
            {cancelled && <span className="inline-block mt-2 px-3 py-1 rounded-md border-2 border-[#b91c1c] text-[#b91c1c] text-[13px] font-extrabold tracking-[0.2em]">CANCELLED</span>}
          </div>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-5 text-[14px]">
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-[#6B7894]">Bill to</p>
            <p className="font-bold text-[15.5px] mt-0.5 break-words">{customer.name}</p>
            {customer.phone && <p className="text-[#4a5672]">{customer.phone}</p>}
            {customer.address && <p className="text-[#4a5672] break-words">{customer.address}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-[12.5px] font-semibold text-[#6B7894]">{credit ? 'Refund' : 'Payment'}</p>
            <p className="font-bold text-[15.5px] mt-0.5">{credit ? `Given back${invoice.reason ? ` · ${invoice.reason}` : ''}` : cancelled ? 'Cancelled' : invoice.payment || '—'}</p>
            {registered && invoice.place_of_supply && <p className="text-[#4a5672]">Place of supply: {invoice.place_of_supply}</p>}
          </div>
        </section>

        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-[13.5px] border-collapse min-w-[560px]">
            <thead>
              <tr className="bg-[#f4f6fa] text-left text-[12.5px] text-[#4a5672]">
                <th className={`${cell} font-semibold`}>#</th>
                <th className={`${cell} font-semibold`}>Item</th>
                <th className={`${cell} font-semibold text-right`}>Qty</th>
                <th className={`${cell} font-semibold text-right`}>Price</th>
                {registered && <th className={`${cell} font-semibold text-right`}>Taxable</th>}
                {registered && <th className={`${cell} font-semibold text-right`}>GST</th>}
                <th className={`${cell} font-semibold text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index} className="border-b border-[#eef1f6] align-top">
                  <td className={`${cell} text-[#6B7894]`}>{index + 1}</td>
                  <td className={cell}>
                    <span className="font-semibold">{line.name}</span>
                    {line.hsn && <span className="block text-[12px] text-[#6B7894]">HSN {line.hsn}</span>}
                    {Number(line.discount) > 0 && <span className="block text-[12px] text-[#6B7894]">Offer − {money(line.discount)}</span>}
                  </td>
                  <td className={`${cell} text-right`}>{line.quantity}</td>
                  <td className={`${cell} text-right`}>{money(line.unit_price)}</td>
                  {registered && <td className={`${cell} text-right`}>{money(line.taxable)}</td>}
                  {registered && <td className={`${cell} text-right`}>{Number(line.rate)}%</td>}
                  <td className={`${cell} text-right font-semibold`}>{money(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="mt-5 flex flex-col sm:flex-row justify-between gap-6">
          <div className="text-[13px] text-[#4a5672] sm:max-w-[50%]">
            <p className="font-semibold text-[#0E1B3D]">Amount in words</p>
            <p className="mt-0.5">{amountInWords(Number(invoice.total))}</p>
            {registered && taxRows.length > 0 && (
              <table className="mt-4 text-[12.5px] border-collapse">
                <thead><tr className="text-[#6B7894]"><th className="pr-4 text-left font-semibold">GST</th><th className="pr-4 text-right font-semibold">Taxable</th>{igst ? <th className="text-right font-semibold">IGST</th> : <><th className="pr-4 text-right font-semibold">CGST</th><th className="text-right font-semibold">SGST</th></>}</tr></thead>
                <tbody>
                  {taxRows.map((row) => (
                    <tr key={row.rate}><td className="pr-4">{Number(row.rate)}%</td><td className="pr-4 text-right">{money(row.taxable)}</td>{igst ? <td className="text-right">{money(row.igst)}</td> : <><td className="pr-4 text-right">{money(row.cgst)}</td><td className="text-right">{money(row.sgst)}</td></>}</tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-4">Prices include GST.</p>
          </div>
          <dl className="w-full sm:w-72 text-[14px] space-y-1.5">
            <div className="flex justify-between"><dt className="text-[#4a5672]">Items</dt><dd>{money(invoice.items_total)}</dd></div>
            {Number(invoice.delivery) > 0 && <div className="flex justify-between"><dt className="text-[#4a5672]">Delivery</dt><dd>{money(invoice.delivery)}</dd></div>}
            {Number(invoice.discount) > 0 && <div className="flex justify-between"><dt className="text-[#4a5672]">Offer</dt><dd>− {money(invoice.discount)}</dd></div>}
            {registered && <div className="flex justify-between"><dt className="text-[#4a5672]">Taxable value</dt><dd>{money(invoice.taxable)}</dd></div>}
            {registered && (igst
              ? <div className="flex justify-between"><dt className="text-[#4a5672]">IGST</dt><dd>{money(invoice.igst)}</dd></div>
              : <>
                <div className="flex justify-between"><dt className="text-[#4a5672]">CGST</dt><dd>{money(invoice.cgst)}</dd></div>
                <div className="flex justify-between"><dt className="text-[#4a5672]">SGST</dt><dd>{money(invoice.sgst)}</dd></div>
              </>)}
            <div className="flex justify-between border-t border-[#e3e8f2] pt-2 text-[16px] font-extrabold"><dt>Total</dt><dd>{money(invoice.total)}</dd></div>
          </dl>
        </section>

        {notes.length > 0 && (
          <section className="mt-6 text-[13.5px]">
            <p className="font-semibold">Credit notes on this invoice</p>
            <ul className="mt-1 space-y-0.5">
              {notes.map((n) => <li key={n.id}><a href={`/invoice/${n.public_token}`} className="text-[#1D5BEA] font-semibold hover:underline">{n.number}</a> · {formatDate(n.issued_at)} · − {money(n.total)}</li>)}
            </ul>
          </section>
        )}

        <footer className="mt-8 pt-4 border-t border-[#e3e8f2] text-[12px] text-[#6B7894]">
          {registered ? 'This is a computer-made invoice and needs no signature.' : 'This shop is not registered for GST, so no GST is charged on this bill.'}
        </footer>
      </article>
    </main>
  )
}

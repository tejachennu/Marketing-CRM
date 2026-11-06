import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { amountInWords, formatRupees } from '@/lib/salon/invoice'
import { formatIstTime } from '@/lib/salon/spoken'
import { PrintButton } from './print-button'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Invoice', robots: { index: false, follow: false } }

const PAYMENT_LABELS: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card' }

async function loadInvoice(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null
  const { data } = await getSupabaseAdminClient().from('salon_invoices').select('*').eq('public_token', token).maybeSingle()
  return data
}

function formatDate(iso: string) {
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : ''
}

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invoice = await loadInvoice(token)
  if (!invoice) notFound()

  const business = invoice.business || {}
  const registered = Boolean(business.gstin)
  const items: any[] = Array.isArray(invoice.items) ? invoice.items : []
  const rates = new Map<number, { taxable: number; tax: number }>()
  for (const item of items) {
    const row = rates.get(Number(item.tax_rate)) || { taxable: 0, tax: 0 }
    row.taxable += Number(item.taxable) || 0
    row.tax += Number(item.tax) || 0
    rates.set(Number(item.tax_rate), row)
  }
  const igst = Number(invoice.igst) > 0
  const money = (value: unknown) => formatRupees(Number(value) || 0)

  return (
    <main className="min-h-screen bg-[#eef1f6] py-6 sm:py-10 px-3 print:bg-white print:p-0">
      <style>{'@page { size: A4; margin: 14mm } @media print { .no-print { display: none !important } }'}</style>
      <div className="no-print max-w-[820px] mx-auto mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-[#4a5672]">Invoice from <strong className="text-[#0E1B3D]">{business.name || 'your salon'}</strong></p>
        <PrintButton />
      </div>

      <article className="relative max-w-[820px] mx-auto bg-white text-[#0E1B3D] rounded-2xl shadow-sm print:shadow-none print:rounded-none p-6 sm:p-10 overflow-hidden">

        <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-5 border-b border-[#e3e8f2] pb-6">
          <div>
            <h1 className="text-[24px] font-extrabold leading-tight">{business.name || 'Invoice'}</h1>
            {business.address && <p className="text-[13.5px] text-[#4a5672] mt-1 whitespace-pre-line max-w-sm">{business.address}</p>}
            <p className="text-[13.5px] text-[#4a5672] mt-1">{[business.phone, business.email].filter(Boolean).join(' · ')}</p>
            {registered && <p className="text-[13.5px] mt-1"><span className="text-[#6B7894]">GSTIN</span> <strong>{business.gstin}</strong></p>}
          </div>
          <div className="sm:text-right">
            <p className="text-[13px] font-bold tracking-[0.15em] text-[#1D5BEA]">{registered ? 'TAX INVOICE' : 'BILL'}</p>
            <p className="text-[20px] font-extrabold mt-1">{invoice.number}</p>
            <p className="text-[13.5px] text-[#4a5672] mt-1">{formatDate(invoice.issued_at)}, {formatIstTime(invoice.issued_at)}</p>
            {invoice.status !== 'unpaid' && (
              <span className={`inline-block mt-2 px-3 py-1 rounded-md border-2 text-[13px] font-extrabold tracking-[0.2em] ${invoice.status === 'paid' ? 'border-[#00A884] text-[#047857]' : 'border-[#b91c1c] text-[#b91c1c]'}`}>{invoice.status === 'paid' ? 'PAID' : 'VOID'}</span>
            )}
          </div>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-5 text-[14px]">
          <div>
            <p className="text-[12.5px] font-semibold text-[#6B7894]">Bill to</p>
            <p className="font-bold text-[15.5px] mt-0.5">{invoice.customer_name}</p>
            {invoice.customer_phone && <p className="text-[#4a5672]">{invoice.customer_phone}</p>}
            {invoice.customer_gstin && <p className="text-[#4a5672]">GSTIN {invoice.customer_gstin}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-[12.5px] font-semibold text-[#6B7894]">Payment</p>
            <p className="font-bold text-[15.5px] mt-0.5">{invoice.status === 'paid' ? `Paid · ${PAYMENT_LABELS[invoice.payment_method] || 'Paid'}` : invoice.status === 'void' ? 'Cancelled' : 'Not paid yet'}</p>
            {invoice.staff_name && <p className="text-[#4a5672]">Served by {invoice.staff_name}</p>}
          </div>
        </section>

        <div className="overflow-x-auto">
          <table className="w-full text-[14px] border-collapse min-w-[520px]">
            <thead>
              <tr className="bg-[#f6f8fc] text-left text-[12.5px] text-[#4a5672]">
                <th className="py-2.5 px-3 font-semibold">#</th>
                <th className="py-2.5 px-3 font-semibold">Service</th>
                <th className="py-2.5 px-3 font-semibold text-right">Qty</th>
                <th className="py-2.5 px-3 font-semibold text-right">Rate</th>
                <th className="py-2.5 px-3 font-semibold text-right">Taxable</th>
                {registered && <th className="py-2.5 px-3 font-semibold text-right">GST</th>}
                <th className="py-2.5 px-3 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={index} className="border-b border-[#eef1f6]">
                  <td className="py-2.5 px-3 text-[#6B7894]">{index + 1}</td>
                  <td className="py-2.5 px-3"><span className="font-semibold">{item.name}</span>{item.sac_code && <span className="block text-[12px] text-[#6B7894]">SAC {item.sac_code}</span>}</td>
                  <td className="py-2.5 px-3 text-right">{item.quantity}</td>
                  <td className="py-2.5 px-3 text-right">{money(item.price)}</td>
                  <td className="py-2.5 px-3 text-right">{money(item.taxable)}</td>
                  {registered && <td className="py-2.5 px-3 text-right">{Number(item.tax_rate)}%</td>}
                  <td className="py-2.5 px-3 text-right font-semibold">{money(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="mt-5 flex flex-col sm:flex-row justify-between gap-6">
          <div className="text-[13px] text-[#4a5672] sm:max-w-[50%]">
            <p className="font-semibold text-[#0E1B3D]">Amount in words</p>
            <p className="mt-0.5">{amountInWords(Number(invoice.total))}</p>
            {registered && rates.size > 0 && (
              <table className="mt-4 text-[12.5px] border-collapse">
                <thead><tr className="text-[#6B7894]"><th className="pr-4 text-left font-semibold">GST</th><th className="pr-4 text-right font-semibold">Taxable</th>{igst ? <th className="text-right font-semibold">IGST</th> : <><th className="pr-4 text-right font-semibold">CGST</th><th className="text-right font-semibold">SGST</th></>}</tr></thead>
                <tbody>
                  {[...rates.entries()].sort((a, b) => a[0] - b[0]).map(([rate, row]) => (
                    <tr key={rate}><td className="pr-4">{rate}%</td><td className="pr-4 text-right">{money(row.taxable)}</td>{igst ? <td className="text-right">{money(row.tax)}</td> : <><td className="pr-4 text-right">{money(row.tax / 2)}</td><td className="text-right">{money(row.tax / 2)}</td></>}</tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <dl className="w-full sm:w-72 text-[14px] space-y-1.5">
            <div className="flex justify-between"><dt className="text-[#4a5672]">Subtotal</dt><dd>{money(invoice.subtotal)}</dd></div>
            {Number(invoice.discount) > 0 && <div className="flex justify-between"><dt className="text-[#4a5672]">Discount</dt><dd>− {money(invoice.discount)}</dd></div>}
            {registered && <div className="flex justify-between"><dt className="text-[#4a5672]">Taxable value</dt><dd>{money(invoice.taxable)}</dd></div>}
            {registered && (igst
              ? <div className="flex justify-between"><dt className="text-[#4a5672]">IGST</dt><dd>{money(invoice.igst)}</dd></div>
              : <>
                <div className="flex justify-between"><dt className="text-[#4a5672]">CGST</dt><dd>{money(invoice.cgst)}</dd></div>
                <div className="flex justify-between"><dt className="text-[#4a5672]">SGST</dt><dd>{money(invoice.sgst)}</dd></div>
              </>)}
            <div className="flex justify-between border-t border-[#e3e8f2] pt-2 mt-2 text-[18px] font-extrabold"><dt>Total</dt><dd>{money(invoice.total)}</dd></div>
            {invoice.prices_include_tax && registered && <p className="text-[12px] text-[#6B7894] text-right">Prices include GST</p>}
          </dl>
        </section>

        <footer className="mt-8 pt-5 border-t border-[#e3e8f2] text-[13px] text-[#4a5672] flex flex-col sm:flex-row justify-between gap-2">
          <p>{business.note || 'Thank you for visiting!'}</p>
          <p className="text-[#8a94a8]">Made with WAMA CRM</p>
        </footer>
      </article>
    </main>
  )
}

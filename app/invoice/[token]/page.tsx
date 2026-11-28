import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { InvoiceDocument, invoiceDate, invoiceMoney, type InvoiceAmountRow, type InvoiceView } from '@/components/invoice/invoice-document'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { amountInWords } from '@/lib/commerce/invoice'
import { creditNoteByToken, creditNotesFor, invoiceByToken } from '@/lib/commerce/invoice-store'
import { isSafeLogoUrl } from '@/lib/salon/logo'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Invoice', robots: { index: false, follow: false } }

/** A shop invoice (or a credit note: money given back on an invoiced order) as the page shows it. */
function shopView(invoice: any, notes: any[], credit: boolean): InvoiceView {
  const business = invoice.business || {}
  const customer = invoice.customer || {}
  const registered = Boolean(invoice.registered)
  const igst = Boolean(invoice.inter_state)
  const cancelled = invoice.status === 'cancelled'
  const lines: any[] = Array.isArray(invoice.lines) ? invoice.lines : []
  const taxRows: any[] = Array.isArray(invoice.tax_summary) ? invoice.tax_summary : []
  const money = (value: unknown) => invoiceMoney(value, business.currency)
  const payment = credit ? `Given back${invoice.reason ? ` · ${invoice.reason}` : ''}` : cancelled ? 'Cancelled' : invoice.payment || '—'

  const totals: InvoiceAmountRow[] = [{ label: 'Items', value: money(invoice.items_total) }]
  if (Number(invoice.delivery) > 0) totals.push({ label: 'Delivery', value: money(invoice.delivery) })
  if (Number(invoice.discount) > 0) totals.push({ label: 'Offer', value: money(invoice.discount), minus: true })
  if (registered) {
    totals.push({ label: 'Taxable value', value: money(invoice.taxable) })
    if (igst) totals.push({ label: 'IGST', value: money(invoice.igst) })
    else totals.push({ label: 'CGST', value: money(invoice.cgst) }, { label: 'SGST', value: money(invoice.sgst) })
  }

  const parties: InvoiceView['parties'] = [
    { label: 'Bill to', title: customer.name, lines: [customer.phone].filter(Boolean) },
  ]
  if (customer.address) parties.push({ label: 'Ship to', lines: [customer.address] })
  parties.push({
    label: credit ? 'Refund' : 'Payment',
    title: payment,
    lines: registered && invoice.place_of_supply ? [`Place of supply: ${invoice.place_of_supply}`] : [],
  })

  const facts: InvoiceView['facts'] = []
  if (credit && invoice.invoice_number) facts.push({ label: 'Against invoice', value: invoice.invoice_number })
  if (invoice.order_number) facts.push({ label: 'Order no.', value: String(invoice.order_number) })

  return {
    title: credit ? 'CREDIT NOTE' : registered ? 'TAX INVOICE' : 'BILL',
    docName: credit ? 'Credit note' : registered ? 'Invoice' : 'Bill',
    numberLabel: credit ? 'Credit note no.' : registered ? 'Invoice no.' : 'Bill no.',
    number: String(invoice.number || ''),
    date: invoiceDate(invoice.issued_at),
    stamp: cancelled ? 'cancelled' : !credit && /^Paid/.test(String(invoice.payment || '')) ? 'paid' : null,
    notice: cancelled ? `This ${registered ? 'invoice' : 'bill'} has been cancelled.` : null,
    business: {
      name: String(business.name || 'Invoice'),
      legalName: business.legal_name && business.legal_name !== business.name ? business.legal_name : null,
      logo: isSafeLogoUrl(business.logo_url) ? business.logo_url : null,
      address: business.address || null,
      contact: [business.phone].filter(Boolean),
      gstin: registered ? business.gstin : null,
      state: registered ? business.state : null,
    },
    facts,
    headline: { label: credit ? 'Given back' : 'Total', value: money(invoice.total) },
    parties,
    itemHeading: 'Item',
    showTax: registered,
    lines: lines.map((line) => ({
      name: String(line.name || ''),
      details: [line.hsn && `HSN ${line.hsn}`, Number(line.discount) > 0 && `Offer − ${money(line.discount)}`].filter(Boolean),
      quantity: Number(line.quantity) || 1,
      rate: money(line.unit_price),
      taxable: money(line.taxable),
      gst: `${Number(line.rate) || 0}%`,
      amount: money(line.total),
    })),
    taxSummary: registered && taxRows.length > 0 ? {
      igst,
      rows: taxRows.map((row) => ({ rate: `${Number(row.rate)}%`, taxable: money(row.taxable), cgst: money(row.cgst), sgst: money(row.sgst), igst: money(row.igst) })),
    } : null,
    totals,
    total: { label: credit ? 'Total given back' : 'Total', value: money(invoice.total) },
    after: [],
    amountInWords: amountInWords(Number(invoice.total)),
    notes: registered ? ['Prices include GST.'] : [],
    related: notes.length > 0 ? {
      title: 'Credit notes on this invoice',
      items: notes.map((n) => ({ href: `/invoice/${n.public_token}`, label: n.number, date: invoiceDate(n.issued_at), amount: money(n.total) })),
    } : null,
    footer: {
      legal: registered ? 'This is a computer-made invoice and needs no signature.' : 'This shop is not registered for GST, so no GST is charged on this bill.',
    },
  }
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
  return <InvoiceDocument view={shopView(invoice, notes, credit)} />
}

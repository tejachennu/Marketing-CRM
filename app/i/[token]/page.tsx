import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { InvoiceDocument, invoiceDate, invoiceMoney, type InvoiceAmountRow, type InvoiceView } from '@/components/invoice/invoice-document'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { BRAND } from '@/lib/brand'
import { amountInWords } from '@/lib/salon/invoice'
import { isSafeLogoUrl } from '@/lib/salon/logo'
import { formatIstTime } from '@/lib/salon/spoken'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Invoice', robots: { index: false, follow: false } }

const PAYMENT_LABELS: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', membership: 'Membership' }

async function loadInvoice(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null
  const { data } = await getSupabaseAdminClient().from('salon_invoices').select('*').eq('public_token', token).maybeSingle()
  return data
}

/** The logo the invoice was issued with; invoices from before logos existed show the current one. */
async function invoiceLogo(invoice: any): Promise<string | null> {
  const business = invoice.business || {}
  if ('logo_url' in business) return isSafeLogoUrl(business.logo_url) ? business.logo_url : null
  const { data } = await getSupabaseAdminClient().from('salon_settings').select('*').eq('organization_id', invoice.organization_id).maybeSingle()
  return isSafeLogoUrl(data?.logo_url) ? data.logo_url : null
}

/** A Front Desk bill as the invoice page shows it. */
function billView(invoice: any, logo: string | null, token: string): InvoiceView {
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
  const money = (value: unknown) => invoiceMoney(value, invoice.business?.currency)
  const status = String(invoice.status || 'unpaid')
  const total = Number(invoice.total) || 0
  const membershipPaid = Number(invoice.membership_paid) || 0
  const advancePaid = Number(invoice.advance_paid) || 0
  const balance = Math.max(0, total - membershipPaid - advancePaid)

  const totals: InvoiceAmountRow[] = [{ label: 'Subtotal', value: money(invoice.subtotal) }]
  if (Number(invoice.discount) > 0) totals.push({ label: 'Discount', value: money(invoice.discount), minus: true })
  if (registered) {
    totals.push({ label: 'Taxable value', value: money(invoice.taxable) })
    if (igst) totals.push({ label: 'IGST', value: money(invoice.igst) })
    else totals.push({ label: 'CGST', value: money(invoice.cgst) }, { label: 'SGST', value: money(invoice.sgst) })
  }
  const after: InvoiceAmountRow[] = []
  if (membershipPaid > 0 || advancePaid > 0) {
    if (membershipPaid > 0) after.push({ label: 'Paid from membership', value: money(membershipPaid), minus: true })
    if (advancePaid > 0) after.push({ label: 'Paid online when booking', value: money(advancePaid), minus: true })
    after.push({ label: status === 'paid' ? 'Paid' : 'To pay', value: money(balance), strong: true })
  }

  return {
    title: registered ? 'TAX INVOICE' : 'BILL',
    docName: registered ? 'Invoice' : 'Bill',
    numberLabel: registered ? 'Invoice no.' : 'Bill no.',
    number: String(invoice.number || ''),
    date: `${invoiceDate(invoice.issued_at)}, ${formatIstTime(invoice.issued_at)}`,
    stamp: status === 'paid' ? 'paid' : status === 'void' ? 'cancelled' : 'unpaid',
    notice: status === 'void' ? `This ${registered ? 'invoice' : 'bill'} has been cancelled.` : null,
    business: {
      name: String(business.name || 'Invoice'),
      logo,
      address: business.address || null,
      contact: [business.phone, business.email].filter(Boolean),
      gstin: registered ? business.gstin : null,
    },
    facts: [],
    headline: status === 'unpaid' ? { label: 'To pay', value: money(balance) } : { label: 'Total', value: money(total) },
    parties: [
      { label: 'Bill to', title: invoice.customer_name, lines: [invoice.customer_phone, invoice.customer_gstin && `GSTIN ${invoice.customer_gstin}`].filter(Boolean) },
      {
        label: 'Payment',
        title: status === 'paid' ? `Paid · ${PAYMENT_LABELS[invoice.payment_method] || 'Paid'}` : status === 'void' ? 'Cancelled' : 'Not paid yet',
        lines: invoice.staff_name ? [`Served by ${invoice.staff_name}`] : [],
      },
    ],
    itemHeading: 'Service',
    showTax: registered,
    lines: items.map((item) => ({
      name: String(item.name || ''),
      details: [item.staff_name && `by ${item.staff_name}`, item.sac_code && `SAC ${item.sac_code}`].filter(Boolean),
      quantity: Number(item.quantity) || 1,
      rate: money(item.price),
      taxable: money(item.taxable),
      gst: `${Number(item.tax_rate) || 0}%`,
      amount: money(item.total),
    })),
    taxSummary: registered && rates.size > 0 ? {
      igst,
      rows: [...rates.entries()].sort((a, b) => a[0] - b[0]).map(([rate, row]) => ({
        rate: `${rate}%`, taxable: money(row.taxable), cgst: money(row.tax / 2), sgst: money(row.tax / 2), igst: money(row.tax),
      })),
    } : null,
    totals,
    total: { label: 'Total', value: money(total) },
    after,
    amountInWords: amountInWords(total),
    notes: invoice.prices_include_tax && registered ? ['Prices include GST.'] : [],
    footer: { message: business.note || 'Thank you for visiting!', madeWith: `Made with ${BRAND.name}` },
    rateHref: status !== 'void' ? `/f/${token}` : null,
  }
}

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invoice = await loadInvoice(token)
  if (!invoice) notFound()
  const logo = await invoiceLogo(invoice)
  return <InvoiceDocument view={billView(invoice, logo, token)} />
}

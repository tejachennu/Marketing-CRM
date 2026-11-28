/**
 * How the public invoice pages look: the Front Desk bill (/i/<token>) and the shop's GST invoice or credit
 * note (/invoice/<token>). Each page turns its saved row into an InvoiceView (plain words and amounts) and
 * this draws it: items as stacked rows on phones (320 px and up, no sideways scroll), the full table from
 * `sm:` up, and an A4 layout on paper (buttons hidden, no shadows).
 */

import { Ban, CheckCircle2, Clock3 } from 'lucide-react'
import { PrintButton, RateLink, ShareButton } from './invoice-actions'

export type InvoiceStamp = 'paid' | 'unpaid' | 'cancelled'

export interface InvoiceLineView {
  name: string
  /** Small lines under the name: who did it, SAC / HSN code, the offer on it */
  details: string[]
  quantity: number
  rate: string
  taxable: string
  /** "18%" */
  gst: string
  amount: string
}

export interface InvoiceAmountRow {
  label: string
  value: string
  /** Taken off ("− ₹500") */
  minus?: boolean
  /** The last, bold line (Paid / To pay) */
  strong?: boolean
}

export interface InvoiceView {
  /** "TAX INVOICE", "BILL", "CREDIT NOTE" */
  title: string
  /** "Invoice", "Bill" or "Credit note": "Invoice from <business>" above the page, and the shared link's title */
  docName: string
  numberLabel: string
  number: string
  date: string
  stamp: InvoiceStamp | null
  /** A red line at the top, e.g. "This bill has been cancelled." */
  notice?: string | null
  business: {
    name: string
    legalName?: string | null
    logo?: string | null
    address?: string | null
    contact: string[]
    gstin?: string | null
    state?: string | null
  }
  /** More facts next to the number and date (order number, the invoice a credit note is against) */
  facts: { label: string; value: string }[]
  /** The amount shown at the top (Total / To pay) */
  headline: { label: string; value: string }
  /** Bill to, Ship to, Payment */
  parties: { label: string; title?: string | null; lines: string[] }[]
  /** "Service" or "Item" */
  itemHeading: string
  /** GST-registered: Taxable and GST columns */
  showTax: boolean
  lines: InvoiceLineView[]
  taxSummary: { igst: boolean; rows: { rate: string; taxable: string; cgst: string; sgst: string; igst: string }[] } | null
  totals: InvoiceAmountRow[]
  total: { label: string; value: string }
  /** Under the total: paid from a membership, paid when booking, then Paid / To pay */
  after: InvoiceAmountRow[]
  amountInWords: string
  notes: string[]
  /** Credit notes on a shop invoice */
  related?: { title: string; items: { href: string; label: string; date: string; amount: string }[] } | null
  footer: { message?: string | null; legal?: string | null; madeWith?: string | null }
  /** "Rate your visit" link (Front Desk bills that are not cancelled) */
  rateHref?: string | null
}

/** "₹1,911.60", always with paise, so the amounts line up in their columns. */
export function invoiceMoney(value: unknown): string {
  const amount = Math.round((Number(value) || 0) * 100) / 100
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "25 Nov 2026" in India time. */
export function invoiceDate(iso: string): string {
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : ''
}

const PRINT_CSS = `@page { size: A4; margin: 10mm 12mm }
@media print {
  html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .invoice-doc { zoom: 0.88; }
  .no-print { display: none !important; }
  .invoice-keep, .invoice-table tr { break-inside: avoid; }
  .invoice-table thead { display: table-header-group; }
}`

const label = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7894]'

const STAMPS: Record<InvoiceStamp, { text: string; className: string; Icon: typeof Ban }> = {
  paid: { text: 'Paid', className: 'border-[#008069] text-[#008069] bg-white', Icon: CheckCircle2 },
  unpaid: { text: 'Not paid', className: 'border-[#b91c1c] text-[#b91c1c] bg-[#fdf0f0]', Icon: Clock3 },
  cancelled: { text: 'Cancelled', className: 'border-[#b91c1c] text-[#b91c1c] bg-[#fdf0f0]', Icon: Ban },
}

function Stamp({ stamp }: { stamp: InvoiceStamp }) {
  const { text, className, Icon } = STAMPS[stamp]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border-2 px-2.5 py-1 text-[12px] sm:text-[12.5px] font-bold uppercase tracking-[0.14em] ${className}`}>
      <Icon size={15} strokeWidth={2.5} aria-hidden />
      {text}
    </span>
  )
}

function AmountRows({ rows }: { rows: InvoiceAmountRow[] }) {
  return (
    <>
      {rows.map((row, index) => (
        <div key={index} className={`flex items-baseline justify-between gap-4 ${row.strong ? 'border-t border-[#e3e8f2] pt-2.5 mt-1 print:pt-1.5 text-[15.5px] font-bold' : 'text-[14px]'}`}>
          <dt className={row.strong ? '' : 'text-[#4a5672]'}>{row.label}</dt>
          <dd className={`tabular-nums whitespace-nowrap ${row.strong ? '' : 'font-medium'}`}>{row.minus ? `− ${row.value}` : row.value}</dd>
        </div>
      ))}
    </>
  )
}

export function InvoiceDocument({ view }: { view: InvoiceView }) {
  const { business } = view
  const actions = view.rateHref ? 3 : 2
  const facts = [{ label: view.numberLabel, value: view.number }, { label: 'Date', value: view.date }, ...view.facts]
  const num = 'py-3 print:py-2 px-3 text-right tabular-nums whitespace-nowrap'
  const head = `bg-[#f4f6fa] border-y border-[#e3e8f2] py-2.5 print:py-2 px-3 ${label}`

  return (
    <main className="min-h-screen bg-[#eef1f6] px-3 py-4 sm:px-6 sm:py-10 text-[#0E1B3D] print:min-h-0 print:bg-white print:p-0">
      <style>{PRINT_CSS}</style>

      <div className="no-print mx-auto mb-3 sm:mb-4 flex max-w-[860px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 break-words text-[13.5px] sm:text-[14px] text-[#4a5672]">{view.docName} from <strong className="font-semibold text-[#0E1B3D]">{business.name}</strong></p>
        <div className={`grid gap-2 sm:flex sm:shrink-0 ${actions === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {view.rateHref && <RateLink href={view.rateHref} />}
          <ShareButton title={`${view.docName} ${view.number} from ${business.name}`} />
          <PrintButton />
        </div>
      </div>

      <article className="invoice-doc mx-auto max-w-[860px] overflow-hidden rounded-2xl border border-[#e3e8f2] bg-white shadow-[0_1px_2px_rgba(14,27,61,0.05),0_12px_32px_-12px_rgba(14,27,61,0.14)] print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
        <div className="h-1.5 bg-[#0E1B3D]" aria-hidden />
        {view.notice && (
          <p className="flex items-center gap-2 border-b border-[#f1d5d5] bg-[#fdf0f0] px-4 py-2.5 text-[13.5px] font-semibold text-[#b91c1c] sm:px-10 print:px-3">
            <Ban size={16} aria-hidden className="shrink-0" /> {view.notice}
          </p>
        )}

        <div className="px-4 pb-6 pt-5 sm:px-10 sm:pb-9 sm:pt-8 print:px-0 print:pb-0 print:pt-4">
          {/* Who the bill is from, and what it is */}
          <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
            <div className={`min-w-0 ${business.logo ? 'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 sm:items-start sm:gap-x-5' : ''}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {business.logo && <img src={business.logo} alt={`${business.name} logo`} className="h-12 w-auto max-w-[96px] object-contain sm:row-span-2 sm:h-16 sm:max-w-[140px]" />}
              <div className="min-w-0">
                <h1 className="break-words text-[20px] font-bold leading-tight tracking-[-0.01em] sm:text-[26px]">{business.name}</h1>
                {business.legalName && <p className="mt-0.5 text-[13px] text-[#4a5672]">{business.legalName}</p>}
              </div>
              <div className={`mt-3 space-y-0.5 text-[13.5px] leading-relaxed text-[#4a5672] ${business.logo ? 'col-span-2 sm:col-span-1 sm:col-start-2 sm:mt-2' : 'sm:mt-2'}`}>
                {business.address && <p className="max-w-md whitespace-pre-line break-words">{business.address}</p>}
                {business.contact.length > 0 && <p className="break-words">{business.contact.join(' · ')}</p>}
                {business.gstin && (
                  <p>
                    <span className="text-[#6B7894]">GSTIN</span> <strong className="font-semibold tracking-[0.02em] text-[#0E1B3D]">{business.gstin}</strong>
                    {business.state && <span className="text-[#6B7894]"> · {business.state}</span>}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#e3e8f2] pt-4 sm:block sm:border-0 sm:pt-1 sm:text-right">
              <p className="text-[15px] font-bold tracking-[0.14em] sm:text-[22px] sm:tracking-[0.1em]">{view.title}</p>
              {view.stamp && <div className="sm:mt-3"><Stamp stamp={view.stamp} /></div>}
            </div>
          </header>

          {/* Number, date and the amount at a glance: one "label … value" row each on phones, side by side wider */}
          <dl className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-[#e3e8f2] bg-[#e3e8f2] sm:mt-8 sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none print:mt-5">
            {facts.map((fact) => (
              <div key={fact.label} className="flex min-w-0 items-baseline justify-between gap-4 bg-[#f4f6fa] px-3.5 py-2.5 sm:block sm:px-4 sm:py-3">
                <dt className={`${label} shrink-0`}>{fact.label}</dt>
                <dd className="min-w-0 break-words text-right text-[14px] font-semibold tabular-nums sm:mt-1 sm:text-left">{fact.value}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 bg-white px-3.5 py-3 sm:block sm:px-4 sm:text-right">
              <dt className={label}>{view.headline.label}</dt>
              <dd className="whitespace-nowrap text-[20px] font-bold leading-tight tabular-nums sm:mt-0.5">{view.headline.value}</dd>
            </div>
          </dl>

          {/* Bill to, ship to, payment */}
          <div className={`mt-6 grid gap-5 sm:mt-8 sm:gap-8 print:mt-5 ${view.parties.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            {view.parties.map((party) => (
              <section key={party.label} className="min-w-0">
                <h2 className={label}>{party.label}</h2>
                {party.title && <p className="mt-1.5 break-words text-[15.5px] font-semibold leading-snug">{party.title}</p>}
                <div className={party.title ? 'mt-0.5' : 'mt-1.5'}>
                  {party.lines.map((line, index) => <p key={index} className="break-words text-[13.5px] leading-relaxed text-[#4a5672]">{line}</p>)}
                </div>
              </section>
            ))}
          </div>

          {/* The lines: stacked on phones, a table on wider screens and on paper */}
          <section className="mt-7 sm:mt-9 print:mt-5" aria-label="Items">
            <div className="sm:hidden print:hidden">
              <div className="flex justify-between border-b border-[#e3e8f2] pb-2">
                <span className={label}>{view.itemHeading}</span>
                <span className={label}>Amount</span>
              </div>
              <ol>
                {view.lines.map((line, index) => (
                  <li key={index} className="flex gap-2.5 border-b border-[#eef1f6] py-3.5">
                    <span className="w-4 shrink-0 pt-px text-[12.5px] tabular-nums text-[#8a94a8]">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 break-words text-[14.5px] font-semibold leading-snug">{line.name}</p>
                        <p className="whitespace-nowrap text-[14.5px] font-semibold leading-snug tabular-nums">{line.amount}</p>
                      </div>
                      {line.details.length > 0 && <p className="mt-0.5 break-words text-[12.5px] text-[#6B7894]">{line.details.join(' · ')}</p>}
                      <p className="mt-1 text-[12.5px] tabular-nums text-[#4a5672]">
                        <span className="whitespace-nowrap">{line.quantity} × {line.rate}</span>
                        {view.showTax && <> · <span className="whitespace-nowrap">Taxable {line.taxable}</span> · <span className="whitespace-nowrap">GST {line.gst}</span></>}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <table className="invoice-table hidden w-full border-collapse text-[14px] sm:table print:table">
              <thead>
                <tr>
                  <th scope="col" className={`${head} w-10 text-left`}>#</th>
                  <th scope="col" className={`${head} text-left`}>{view.itemHeading}</th>
                  <th scope="col" className={`${head} w-[1%] whitespace-nowrap text-right`}>Qty</th>
                  <th scope="col" className={`${head} w-[1%] whitespace-nowrap text-right`}>Rate</th>
                  {view.showTax && <th scope="col" className={`${head} w-[1%] whitespace-nowrap text-right`}>Taxable</th>}
                  {view.showTax && <th scope="col" className={`${head} w-[1%] whitespace-nowrap text-right`}>GST</th>}
                  <th scope="col" className={`${head} w-[1%] whitespace-nowrap text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {view.lines.map((line, index) => (
                  <tr key={index} className="border-b border-[#eef1f6] align-top">
                    <td className="px-3 py-3 print:py-2 tabular-nums text-[#8a94a8]">{index + 1}</td>
                    <td className="px-3 py-3 print:py-2">
                      <span className="block break-words font-semibold leading-snug">{line.name}</span>
                      {line.details.length > 0 && <span className="mt-0.5 block text-[12.5px] text-[#6B7894]">{line.details.join(' · ')}</span>}
                    </td>
                    <td className={num}>{line.quantity}</td>
                    <td className={num}>{line.rate}</td>
                    {view.showTax && <td className={num}>{line.taxable}</td>}
                    {view.showTax && <td className={num}>{line.gst}</td>}
                    <td className={`${num} font-semibold`}>{line.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Totals; amount in words and the GST summary beside them */}
          <div className="mt-6 grid items-start gap-6 sm:mt-7 sm:grid-cols-[minmax(0,1fr)_300px] sm:gap-10 print:mt-4">
            <div className="invoice-keep overflow-hidden rounded-xl border border-[#e3e8f2] sm:order-2">
              <dl className="space-y-2 px-4 py-3.5 print:space-y-1 print:py-2.5">
                <AmountRows rows={view.totals} />
              </dl>
              <div className="flex items-baseline justify-between gap-4 bg-[#0E1B3D] px-4 py-3 text-white print:py-2">
                <span className="text-[14.5px] font-semibold">{view.total.label}</span>
                <span className="whitespace-nowrap text-[19px] font-bold tabular-nums">{view.total.value}</span>
              </div>
              {view.after.length > 0 && (
                <dl className="space-y-2 px-4 py-3.5 print:space-y-1 print:py-2.5">
                  <AmountRows rows={view.after} />
                </dl>
              )}
            </div>

            <div className="min-w-0 space-y-5 sm:order-1 print:space-y-4">
              <div className="invoice-keep">
                <p className={label}>Amount in words</p>
                <p className="mt-1 text-[14px] font-medium leading-relaxed">{view.amountInWords}</p>
              </div>
              {view.taxSummary && view.taxSummary.rows.length > 0 && (
                <div className="invoice-keep">
                  <p className={label}>GST summary</p>
                  <table className="mt-2 w-full max-w-[440px] border-collapse text-[12.5px] tabular-nums">
                    <thead>
                      <tr className="border-b border-[#e3e8f2] text-[#6B7894]">
                        <th scope="col" className="py-1.5 pr-3 text-left font-semibold">GST</th>
                        <th scope="col" className="py-1.5 pl-2 text-right font-semibold">Taxable</th>
                        {view.taxSummary.igst
                          ? <th scope="col" className="py-1.5 pl-2 text-right font-semibold">IGST</th>
                          : <>
                            <th scope="col" className="py-1.5 pl-2 text-right font-semibold">CGST</th>
                            <th scope="col" className="py-1.5 pl-2 text-right font-semibold">SGST</th>
                          </>}
                      </tr>
                    </thead>
                    <tbody>
                      {view.taxSummary.rows.map((row) => (
                        <tr key={row.rate} className="border-b border-[#eef1f6] text-[#4a5672]">
                          <td className="py-1.5 pr-3 font-medium text-[#0E1B3D]">{row.rate}</td>
                          <td className="whitespace-nowrap py-1.5 pl-2 text-right">{row.taxable}</td>
                          {view.taxSummary!.igst
                            ? <td className="whitespace-nowrap py-1.5 pl-2 text-right">{row.igst}</td>
                            : <>
                              <td className="whitespace-nowrap py-1.5 pl-2 text-right">{row.cgst}</td>
                              <td className="whitespace-nowrap py-1.5 pl-2 text-right">{row.sgst}</td>
                            </>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {view.notes.map((note) => <p key={note} className="text-[12.5px] text-[#6B7894]">{note}</p>)}
            </div>
          </div>

          {view.related && view.related.items.length > 0 && (
            <section className="invoice-keep mt-7 print:mt-5">
              <h2 className={label}>{view.related.title}</h2>
              <ul className="mt-2 divide-y divide-[#eef1f6] rounded-xl border border-[#e3e8f2]">
                {view.related.items.map((item) => (
                  <li key={item.href} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 py-2.5 text-[13.5px]">
                    <a href={item.href} className="font-semibold text-[#008069] hover:text-[#006d5b] hover:underline">{item.label}</a>
                    <span className="text-[#6B7894]">{item.date}</span>
                    <span className="ml-auto whitespace-nowrap font-semibold tabular-nums">− {item.amount}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <footer className="mt-8 flex flex-col gap-3 border-t border-[#e3e8f2] pt-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6 print:mt-6 print:pt-3">
            <div className="min-w-0">
              {view.footer.message && <p className="break-words text-[14px] font-medium leading-relaxed">{view.footer.message}</p>}
              {view.footer.legal && <p className={`text-[12.5px] text-[#6B7894] ${view.footer.message ? 'mt-1' : ''}`}>{view.footer.legal}</p>}
            </div>
            {view.footer.madeWith && <p className="shrink-0 text-[12px] text-[#8a94a8]">{view.footer.madeWith}</p>}
          </footer>
        </div>
      </article>
    </main>
  )
}

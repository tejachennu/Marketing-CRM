import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { isSafeLogoUrl } from '@/lib/salon/logo'
import { publicCard, usageWords } from '@/lib/salon/memberships'
import { formatRupees } from '@/lib/salon/invoice'
import { businessCurrency } from '@/lib/money'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Membership card', robots: { index: false, follow: false } }

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

/** A customer's membership card: show it at the counter (card number and QR), with what is left. */
export default async function MembershipCardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound()
  const db = getSupabaseAdminClient()
  const { data: card } = await db.from('salon_memberships').select('*').eq('public_token', token).maybeSingle()
  if (!card) notFound()
  const [{ data: settings }, { data: usage }, { data: org }] = await Promise.all([
    db.from('salon_settings').select('business_name, logo_url, phone').eq('organization_id', card.organization_id).maybeSingle(),
    db.from('salon_membership_usage').select('kind, detail, amount, sessions, created_at').eq('membership_id', card.id).order('created_at', { ascending: false }).limit(20),
    db.from('organizations').select('*').eq('id', card.organization_id).maybeSingle(),
  ])
  const currency = businessCurrency(org)
  const view = publicCard(card, { name: settings?.business_name, logo_url: isSafeLogoUrl(settings?.logo_url) ? settings?.logo_url : null, phone: settings?.phone }, usage || [])
  const qr = await QRCode.toDataURL(view.cardNumber, { margin: 1, width: 240, color: { dark: '#0E1B3D', light: '#ffffff' } })
  const live = view.state === 'active' || view.state === 'expiring'

  return (
    <main className="min-h-screen bg-[#f4f6fa] px-4 py-8 text-[#0E1B3D]">
      <div className="mx-auto max-w-md space-y-4">
        <section style={{ background: view.colour }} className="relative overflow-hidden rounded-3xl p-6 text-white shadow-lg">
          <span aria-hidden="true" className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
          <span aria-hidden="true" className="absolute -right-4 bottom-[-60px] h-40 w-40 rounded-full bg-white/10" />
          <div className="relative flex items-center gap-3">
            {view.business.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view.business.logo} alt="" className="h-10 w-10 rounded-full bg-white object-cover" />
            ) : (
              <span className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center font-bold">{view.business.name.slice(0, 1)}</span>
            )}
            <p className="font-bold text-[16px] truncate">{view.business.name}</p>
          </div>
          <p className="relative mt-6 text-[13px] uppercase tracking-widest text-white/80">{view.plan} membership</p>
          <p className="relative mt-1 text-[24px] font-extrabold leading-tight break-words">{view.name}</p>
          <div className="relative mt-5 flex items-end justify-between gap-3">
            <div>
              <p className="text-[12px] text-white/75">Card number</p>
              <p className="font-mono text-[18px] font-bold tracking-wider">{view.cardNumber}</p>
              <p className="mt-2 text-[12.5px] text-white/85">Valid {day(view.startsAt)} – {day(view.expiresAt)}</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt={`QR code for card ${view.cardNumber}`} className="h-24 w-24 rounded-xl bg-white p-1.5 shrink-0" />
          </div>
        </section>

        <p className={`text-center text-[14px] font-bold ${live ? 'text-[#0E1B3D]' : 'text-[#b91c1c]'}`}>{view.stateWords}{view.state === 'expiring' ? ` · ends ${day(view.expiresAt)}` : ''}</p>

        <section className="rounded-2xl bg-white border border-[#e3e8f2] p-5 space-y-3">
          <h2 className="text-[16px] font-extrabold">What is left on your card</h2>
          {view.credit > 0 || view.sessions.length || view.discount ? (
            <ul className="space-y-2.5 text-[15px]">
              {(view.credit > 0 || Number(card.plan?.credit) > 0) && <li className="flex justify-between gap-3"><span>Credit to spend</span><b>{formatRupees(view.credit, currency)}</b></li>}
              {view.sessions.map((s) => (
                <li key={s.name} className="flex justify-between gap-3"><span className="min-w-0 break-words">{s.name}</span><b className="shrink-0">{s.left} of {s.total} left</b></li>
              ))}
              {view.discount > 0 && <li className="flex justify-between gap-3"><span>Discount on services</span><b>{view.discount}% off</b></li>}
            </ul>
          ) : <p className="text-[14.5px] text-[#6B7894]">Nothing is left on this card.</p>}
          <p className="text-[13px] text-[#6B7894]">Show this card or tell your card number at the counter.</p>
        </section>

        {view.history.length > 0 && (
          <section className="rounded-2xl bg-white border border-[#e3e8f2] p-5">
            <h2 className="text-[16px] font-extrabold mb-2">History</h2>
            <ul className="divide-y divide-[#eef1f6]">
              {view.history.map((h, i) => (
                <li key={i} className="py-2.5 flex justify-between gap-3 text-[14px]">
                  <span className="min-w-0 break-words">{usageWords(h, currency)}</span>
                  <span className="shrink-0 text-[#6B7894]">{day(h.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {view.terms && <p className="text-[12.5px] text-[#6B7894] whitespace-pre-line px-1">{view.terms}</p>}
        {view.business.phone && <p className="text-center text-[14px]"><a href={`tel:${view.business.phone}`} className="font-semibold text-[#1D5BEA]">Call {view.business.name}</a></p>}
      </div>
    </main>
  )
}

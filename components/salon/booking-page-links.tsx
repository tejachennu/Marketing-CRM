'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Download, ExternalLink, Loader2, QrCode } from 'lucide-react'
import { api, card, secondaryButton } from './ui'
import type { SalonSetup } from './types'

/** A QR code picture for a link, as a PNG data address. */
function useQr(link: string) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(link, { margin: 1, width: 480, color: { dark: '#0E1B3D', light: '#ffffff' } }).then((url) => { if (!cancelled) setSrc(url) }).catch(() => setSrc(''))
    return () => { cancelled = true }
  }, [link])
  return src
}

function LinkRow({ label, hint, link, file, flash }: { label: string; hint?: string; link: string; file: string; flash: (message: string) => void }) {
  const qr = useQr(link)
  return (
    <li className="flex items-center gap-3 py-3 min-w-0">
      {qr ? <img src={qr} alt={`QR code for ${label}`} className="h-16 w-16 shrink-0 rounded-lg border border-[#eef1f6]" /> : <span className="h-16 w-16 shrink-0 rounded-lg bg-[#f4f6fa] flex items-center justify-center"><QrCode size={20} className="text-[#8a94a8]" /></span>}
      <div className="flex-1 min-w-0">
        <p className="text-[14.5px] font-semibold text-[#0E1B3D] dark:text-white truncate">{label}</p>
        {hint && <p className="text-[12.5px] text-[#6B7894] truncate">{hint}</p>}
        <p className="text-[12.5px] text-[#4a5672] dark:text-slate-400 truncate">{link.replace(/^https?:\/\//, '')}</p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button type="button" title="Copy link" aria-label={`Copy the link for ${label}`} onClick={() => navigator.clipboard?.writeText(link).then(() => flash('Link copied'))} className="h-9 w-9 rounded-lg border border-[#d5ddeb] dark:border-slate-700 flex items-center justify-center hover:border-[#1D5BEA] hover:text-[#1D5BEA] cursor-pointer"><Copy size={15} /></button>
        {qr && <a href={qr} download={`${file}.png`} title="Download QR code" aria-label={`Download the QR code for ${label}`} className="h-9 w-9 rounded-lg border border-[#d5ddeb] dark:border-slate-700 flex items-center justify-center hover:border-[#1D5BEA] hover:text-[#1D5BEA]"><Download size={15} /></a>}
      </div>
    </li>
  )
}

/**
 * Front Desk → Setup → Booking page: the business's public booking link, and a link with a QR code for
 * the whole business, each person and each service, to share on Instagram and WhatsApp, put on Google
 * Maps, or print for the counter.
 */
export function BookingPageLinks({ orgId, setup, flash }: { orgId: string; setup: SalonSetup; flash: (message: string) => void }) {
  const [slug, setSlug] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api(`/api/organization?organizationId=${orgId}`).then((data) => setSlug(data?.organization?.slug || '')).catch((err) => setError(err.message))
  }, [orgId])
  if (error) return <p className="text-[14px] text-[#b91c1c]">{error}</p>
  if (slug === null) return <Loader2 className="animate-spin text-[#1D5BEA]" size={22} />
  const base = `${typeof window !== 'undefined' ? window.location.origin : 'https://wamacrm.magnetora.in'}/b/${slug}`
  const services = (setup.services || []).filter((s: any) => s.active !== false)
  const staff = (setup.staff || []).filter((m: any) => m.active !== false)
  const safe = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'qr'

  return (
    <div className="space-y-4">
      <section className={`${card} p-5`}>
        <h2 className="text-[18px] font-extrabold text-[#0E1B3D] dark:text-white">Your booking page</h2>
        <p className="text-[14px] text-[#4a5672] dark:text-slate-400 mt-1">Customers pick a service, a person and a free time, and the booking comes to your Front Desk list. Put the link in your Instagram bio, WhatsApp status and Google Maps, and print the QR code for your counter.</p>
        {!services.length && <p className="mt-3 text-[13.5px] rounded-xl bg-[#fdf0f0] text-[#b91c1c] px-3 py-2">Add your services first (Setup → Services). The page opens once there is something to book.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={base} target="_blank" rel="noreferrer" className={secondaryButton}><ExternalLink size={16} /> Open my page</a>
          <button type="button" onClick={() => navigator.clipboard?.writeText(base).then(() => flash('Link copied'))} className={secondaryButton}><Copy size={16} /> Copy link</button>
        </div>
        <p className="mt-3 text-[12.5px] text-[#6B7894]">
          {setup.settings?.auto_approve_bookings ? 'Bookings are accepted on their own.' : 'Each booking waits for you to accept it (WhatsApp settings → accept bookings on their own).'}
        </p>
      </section>

      <section className={`${card} p-5`}>
        <h3 className="text-[16px] font-bold text-[#0E1B3D] dark:text-white">Links and QR codes</h3>
        <ul className="divide-y divide-[#eef1f6] dark:divide-slate-800 mt-1">
          <LinkRow label={setup.settings?.business_name || 'Whole business'} hint="Every service and person" link={base} file={`booking-${safe(slug)}`} flash={flash} />
          {staff.map((m: any) => <LinkRow key={m.id} label={m.name} hint="Opens with this person picked" link={`${base}?p=${m.id}`} file={`booking-${safe(m.name)}`} flash={flash} />)}
          {services.map((s: any) => <LinkRow key={s.id} label={s.name} hint="Opens with this service picked" link={`${base}?s=${s.id}`} file={`booking-${safe(s.name)}`} flash={flash} />)}
        </ul>
      </section>
    </div>
  )
}

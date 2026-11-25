'use client'

/**
 * Front Desk → Setup → Website and booking: the business's own website. On/off, the address (our free one, or the
 * the business's own domain, shared with the online store), the cover photo, a gallery, a line and a few words about
 * the business, a colour, which parts to show, which call-to-action buttons show (Call, WhatsApp, Book now, Shop
 * online, Directions and map), and what the domain opens when the store is on too. Without appointments (Setup →
 * Appointments) there is no booking: Book now is unavailable and the booking payment settings are hidden.
 */

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { DEFAULT_SITE, MAX_GALLERY, SITE_BUTTONS, SITE_COLOURS, buttonBlocker, readSite, type SiteSettings } from '@/lib/salon/website'
import { StoreAddress } from '@/components/commerce/storefront-settings'
import { OnlinePayments } from '@/components/payments/online-payments'
import { ADVANCE_CHOICES } from '@/lib/salon/booking-pay'
import { api, card, input, primaryButton, secondaryButton, Toggle } from './ui'

async function uploadPhoto(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use a JPG, PNG or WebP photo.')
  if (file.size > 4 * 1024 * 1024) throw new Error('Photos can be up to 4 MB.')
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/media/upload', { method: 'POST', body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !/^https:\/\//.test(String(data.url || ''))) throw new Error(data.error || 'The photo could not be uploaded. Try again.')
  return data.url
}

export function SalonWebsite({ orgId, canEdit, canManageDomain, flash }: { orgId: string; canEdit: boolean; canManageDomain: boolean; flash: (kind: 'success' | 'error', message: string) => void }) {
  const [site, setSite] = useState<SiteSettings>(DEFAULT_SITE)
  const [saved, setSaved] = useState('')
  const [meta, setMeta] = useState<{ slug: string; storeOn: boolean; domain: string | null; instagram: { connected: boolean; username: string }; chatProblem: string | null; takesAppointments: boolean; hasPhone: boolean; hasAddress: boolean } | null>(null)
  const [gatewayOn, setGatewayOn] = useState(false)
  const [busy, setBusy] = useState<'' | 'save' | 'cover' | 'gallery'>('')
  const coverRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api(`/api/salon/website?organizationId=${orgId}`).then((data) => {
      const s = readSite(data.site)
      setSite(s)
      setSaved(JSON.stringify(s))
      setMeta({ slug: data.slug, storeOn: data.storeOn, domain: data.domain, instagram: data.instagram || { connected: false, username: '' }, chatProblem: data.chatProblem || null, takesAppointments: data.takesAppointments !== false, hasPhone: data.hasPhone !== false, hasAddress: data.hasAddress !== false })
    }).catch((err) => flash('error', err.message))
    // Loaded once per workspace (flash may be a new function on every render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  if (!meta) return <Loader2 className="animate-spin text-[#1D5BEA]" size={22} />
  const set = (patch: Partial<SiteSettings>) => setSite((s) => ({ ...s, ...patch }))
  const bookings = meta.takesAppointments
  const reach = { bookings, store: meta.storeOn, phone: meta.hasPhone, address: meta.hasAddress }
  // Shop online is offered only when the online store is on
  const dirty = JSON.stringify(site) !== saved
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://wamacrm.magnetora.in'
  const link = meta.domain && (!meta.storeOn || site.domainShows === 'website') ? `https://${meta.domain}` : `${origin}/v/${meta.slug}`

  async function save() {
    setBusy('save')
    try {
      const data = await api('/api/salon/website', { method: 'PUT', body: JSON.stringify({ organizationId: orgId, site }) })
      const s = readSite(data.site)
      setSite(s)
      setSaved(JSON.stringify(s))
      flash('success', 'Website saved.')
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy('')
    }
  }

  async function pickCover(files: FileList | null) {
    const file = files?.[0]
    if (coverRef.current) coverRef.current.value = ''
    if (!file) return
    setBusy('cover')
    try { set({ cover: await uploadPhoto(file) }) } catch (err: any) { flash('error', err.message) } finally { setBusy('') }
  }

  async function pickGallery(files: FileList | null) {
    const list = Array.from(files || []).slice(0, MAX_GALLERY - site.gallery.length)
    if (galleryRef.current) galleryRef.current.value = ''
    if (!list.length) return
    setBusy('gallery')
    try {
      const urls: string[] = []
      for (const file of list) urls.push(await uploadPhoto(file))
      setSite((s) => ({ ...s, gallery: [...s.gallery, ...urls].slice(0, MAX_GALLERY) }))
    } catch (err: any) {
      flash('error', err.message)
    } finally {
      setBusy('')
    }
  }

  const label = 'block text-[13px] font-bold text-[#4a5672] dark:text-slate-300 mb-1.5'
  const check = (key: keyof SiteSettings['show'], text: string) => (
    <label className="flex items-center gap-2.5 text-[14px] text-[#0E1B3D] dark:text-white cursor-pointer">
      <input type="checkbox" checked={site.show[key]} disabled={!canEdit} onChange={(e) => set({ show: { ...site.show, [key]: e.target.checked } })} className="h-4 w-4 accent-[#1D5BEA]" /> {text}
    </label>
  )

  return (
    <div className="space-y-4">
      <section className={`${card} p-5`}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-extrabold text-[#0E1B3D] dark:text-white">Your website</h2>
            <p className="text-[14px] text-[#4a5672] dark:text-slate-400 mt-1">A full website for your business: services and prices{bookings ? ' with Book' : ''}, your team, photos, reviews, hours and a map. Share it on Google Maps, Instagram and WhatsApp.</p>
          </div>
          <label className="inline-flex items-center gap-2 text-[14px] font-bold cursor-pointer shrink-0">
            <input type="checkbox" checked={site.enabled} disabled={!canEdit} onChange={(e) => set({ enabled: e.target.checked })} className="h-5 w-5 accent-[#1D5BEA]" /> {site.enabled ? 'On' : 'Off'}
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="min-w-0 max-w-full truncate rounded-lg bg-[#f4f6fa] dark:bg-slate-900 px-3 py-2 text-[13.5px] font-semibold text-[#0E1B3D] dark:text-white">{link.replace(/^https?:\/\//, '')}</span>
          <a href={link} target="_blank" rel="noreferrer" className={secondaryButton}><ExternalLink size={16} /> Open</a>
          <button type="button" onClick={() => navigator.clipboard?.writeText(link).then(() => flash('success', 'Link copied'))} className={secondaryButton}><Copy size={16} /> Copy link</button>
        </div>
      </section>

      <section className={`${card} p-5 space-y-4`}>
        <h3 className="text-[16px] font-bold text-[#0E1B3D] dark:text-white">How it looks</h3>
        <div>
          <p className={label}>Cover photo (the big photo at the top)</p>
          <div className="flex flex-wrap items-center gap-3">
            {site.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={site.cover} alt="Cover" className="h-24 w-40 rounded-lg object-cover border border-[#e3e8f2]" />
            ) : <span className="h-24 w-40 rounded-lg bg-[#0E1B3D] text-white/70 text-[12px] flex items-center justify-center text-center px-2">No photo: a plain dark top</span>}
            <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pickCover(e.target.files)} />
            {canEdit && <button type="button" onClick={() => coverRef.current?.click()} disabled={Boolean(busy)} className={secondaryButton}>{busy === 'cover' ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />} {site.cover ? 'Change' : 'Upload'}</button>}
            {canEdit && site.cover && <button type="button" onClick={() => set({ cover: '' })} className={secondaryButton}><Trash2 size={15} /> Remove</button>}
          </div>
          <p className="mt-1 text-[12px] text-[#6B7894]">A wide photo of your place or your work looks best (landscape, at least 1600 pixels wide).</p>
        </div>
        <div>
          <label htmlFor="site-tagline" className={label}>One line about you</label>
          <input id="site-tagline" maxLength={140} disabled={!canEdit} value={site.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="Hair, skin and bridal studio in Banjara Hills" className={input} />
        </div>
        <div>
          <label htmlFor="site-about" className={label}>About your business (optional)</label>
          <textarea id="site-about" rows={4} maxLength={1500} disabled={!canEdit} value={site.about} onChange={(e) => set({ about: e.target.value })} placeholder="How long you have been open, what you are known for, why people come back." className={`${input} h-auto py-2.5`} />
        </div>
        <div>
          <p className={label}>Colour</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
            {SITE_COLOURS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={site.colour === c} aria-label={c} disabled={!canEdit} onClick={() => set({ colour: c })} className="h-9 w-9 rounded-full flex items-center justify-center ring-offset-2 cursor-pointer" style={{ background: c, boxShadow: site.colour === c ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : undefined }}>
                {site.colour === c && <Check size={16} className="text-white" />}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className={`${card} p-5 space-y-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[16px] font-bold text-[#0E1B3D] dark:text-white mr-auto">Photos ({site.gallery.length}/{MAX_GALLERY})</h3>
          <input ref={galleryRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pickGallery(e.target.files)} />
          {canEdit && site.gallery.length < MAX_GALLERY && <button type="button" onClick={() => galleryRef.current?.click()} disabled={Boolean(busy)} className={secondaryButton}>{busy === 'gallery' ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />} Add photos</button>}
        </div>
        <label className="flex items-start gap-2.5 rounded-xl border border-[#e3e8f2] dark:border-slate-700 p-3 cursor-pointer">
          <input type="checkbox" checked={site.instagramLive} disabled={!canEdit} onChange={(e) => set({ instagramLive: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[#1D5BEA]" />
          <span className="min-w-0 text-[13.5px]">
            <span className="block font-bold text-[#0E1B3D] dark:text-white">Show my latest Instagram posts</span>
            <span className="block text-[#6B7894]">{meta.instagram.connected
              ? <>From <b>@{meta.instagram.username || 'your account'}</b>, by themselves: new posts appear on the website within 30 minutes.</>
              : <>Connect Instagram first in <a href="/dashboard/settings?tab=instagram" className="font-semibold text-[#1D5BEA] hover:underline">Settings → Instagram</a>. Until then, your photos above show.</>}</span>
          </span>
        </label>
        {site.gallery.length === 0 ? <p className="text-[13.5px] text-[#6B7894]">Add photos of your place, your team at work and results customers love. The first one shows biggest.</p> : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {site.gallery.map((src, i) => (
              <div key={src} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Photo ${i + 1}`} className="aspect-square w-full rounded-lg object-cover border border-[#e3e8f2]" />
                {canEdit && <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => set({ gallery: site.gallery.filter((x) => x !== src) })} className="absolute top-1 right-1 h-7 w-7 rounded-full bg-white/95 shadow flex items-center justify-center text-[#b91c1c] cursor-pointer"><Trash2 size={13} /></button>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={`${card} p-5 space-y-3`}>
        <h3 className="text-[16px] font-bold text-[#0E1B3D] dark:text-white">What to show</h3>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {check('prices', 'Prices of services')}
          {check('team', bookings ? 'Your team, with Book with each person' : 'Your team')}
          {check('memberships', 'Memberships')}
          {check('reviews', 'Customer reviews (4 and 5 stars with words)')}
        </div>
        <label className="flex items-start gap-2.5 rounded-xl border border-[#e3e8f2] dark:border-slate-700 p-3 cursor-pointer">
          <input type="checkbox" checked={site.chat} disabled={!canEdit} onChange={(e) => set({ chat: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[#1D5BEA]" />
          <span className="min-w-0 text-[13.5px]">
            <span className="block font-bold text-[#0E1B3D] dark:text-white">AI chat on your website</span>
            <span className="block text-[#6B7894]">An "Ask us" button that answers visitors from your services and prices, timings, team, memberships and Knowledge Base{bookings ? ', shows services with Book, and checks a customer\'s booking' : ''}. Each answer uses a little of your AI credit.</span>
            {site.chat && meta.chatProblem && (
              <span role="alert" className="mt-2 block rounded-lg bg-[#fdf0f0] p-2 text-[12.5px] font-semibold text-[#b91c1c]">
                The chat is hidden on your website: {meta.chatProblem}{/credit/i.test(meta.chatProblem) && <a href="/dashboard/billing" className="ml-1 underline">Open Billing</a>}
              </span>
            )}
          </span>
        </label>
        <div className="max-w-sm">
          <label htmlFor="site-ig" className={label}>Instagram (optional)</label>
          <input id="site-ig" maxLength={60} disabled={!canEdit} value={site.instagram} onChange={(e) => set({ instagram: e.target.value })} placeholder="@yourstudio" className={input} />
        </div>
      </section>

      <section className={`${card} p-5 space-y-3`} aria-labelledby="site-buttons-title">
        <div>
          <h3 id="site-buttons-title" className="text-[16px] font-bold text-[#0E1B3D] dark:text-white">Buttons on your website</h3>
          <p className="text-[13.5px] text-[#4a5672] dark:text-slate-400 mt-1">Switch off any button you do not want customers to see. It goes from every place on the page: the top, the phone bar and the bottom.</p>
        </div>
        <ul className="rounded-xl border border-[#e3e8f2] dark:border-slate-700 divide-y divide-[#eef1f6] dark:divide-slate-800">
          {SITE_BUTTONS.filter(({ key }) => key !== 'shop' || meta.storeOn).map(({ key, label, hint }) => {
            const blocker = buttonBlocker(key, reach)
            // Book now cannot show without appointments: shown switched off, with the reason
            const unavailable = key === 'book' && !bookings
            const on = site.buttons[key] && !unavailable
            return (
              <li key={key} className="flex items-center gap-3 px-3.5 py-3">
                <span className="min-w-0 flex-1">
                  <span className={`block text-[14.5px] font-bold ${unavailable ? 'text-[#8a94a8]' : 'text-[#0E1B3D] dark:text-white'}`}>{label}</span>
                  <span className="block text-[13px] text-[#6B7894] dark:text-slate-400">{hint}</span>
                  {blocker && site.buttons[key] && <span className="block mt-0.5 text-[12.5px] font-semibold text-[#4a5672] dark:text-slate-300">{blocker}</span>}
                </span>
                <Toggle checked={on} disabled={!canEdit || unavailable} onChange={(value) => set({ buttons: { ...site.buttons, [key]: value } })} label={`${label} button`} />
              </li>
            )
          })}
        </ul>
        {Object.entries(site.buttons).every(([key, value]) => !value || buttonBlocker(key as keyof SiteSettings['buttons'], reach)) && (
          <p className="text-[12.5px] text-[#6B7894]">With every button off, the phone bar at the bottom of your website is not shown.</p>
        )}
      </section>

      {bookings && <section className={`${card} p-5 space-y-4`}>
        <div>
          <h3 className="text-[16px] font-bold text-[#0E1B3D] dark:text-white">Payment when booking</h3>
          <p className="text-[13.5px] text-[#4a5672] dark:text-slate-400 mt-1">On your website and booking page. An online payment keeps the time for 30 minutes; once paid, the booking is confirmed on WhatsApp and the amount is taken off the bill.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Payment when booking">
          {([['shop', 'Pay at the shop', 'No online payment'], ['choice', 'Customer chooses', 'Pay now or at the shop'], ['online', 'Pay online to book', 'Fewer no-shows']] as const).map(([value, title, sub]) => (
            <button key={value} type="button" role="radio" aria-checked={site.bookingPay.mode === value} disabled={!canEdit} onClick={() => set({ bookingPay: { ...site.bookingPay, mode: value } })}
              className={`text-left rounded-xl border-2 p-3 cursor-pointer ${site.bookingPay.mode === value ? 'border-[#1D5BEA] bg-[#f4f7fe] dark:bg-slate-900' : 'border-[#e3e8f2] dark:border-slate-700'}`}>
              <span className="block text-[14px] font-bold text-[#0E1B3D] dark:text-white">{title}</span>
              <span className="block text-[12.5px] text-[#6B7894]">{sub}</span>
            </button>
          ))}
        </div>
        {site.bookingPay.mode !== 'shop' && (
          <>
            <div>
              <p className={label}>How much is paid online</p>
              <div className="flex flex-wrap gap-2">
                {ADVANCE_CHOICES.map((n) => (
                  <button key={n} type="button" aria-pressed={site.bookingPay.advance === n} disabled={!canEdit} onClick={() => set({ bookingPay: { ...site.bookingPay, advance: n } })}
                    className={`h-9 px-3.5 rounded-full border text-[13.5px] font-semibold cursor-pointer ${site.bookingPay.advance === n ? 'border-[#1D5BEA] bg-[#1D5BEA] text-white' : 'border-[#d5ddeb] dark:border-slate-700 text-[#0E1B3D] dark:text-white'}`}>
                    {n === 100 ? 'Full amount' : `${n}% advance`}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[12px] text-[#6B7894]">{site.bookingPay.advance === 100 ? 'Customers pay the whole price of the services when they book.' : `Customers pay ${site.bookingPay.advance}% (rounded up to whole rupees) when they book, and the rest at the shop.`}</p>
            </div>
            {!gatewayOn && <p role="alert" className="rounded-lg bg-[#fdf0f0] p-2.5 text-[13px] font-semibold text-[#b91c1c]">Connect Razorpay or Stripe below. Until then, customers pay at the shop.</p>}
            <OnlinePayments orgId={orgId} canManage={canManageDomain} showToast={flash} onChange={(state) => setGatewayOn(Boolean(state.use))} />
          </>
        )}
      </section>}

      <StoreAddress orgId={orgId} canManage={canManageDomain} showToast={(kind, text) => flash(kind, text)} kind="website" ourLink={`${origin}/v/${meta.slug}`} />
      {meta.storeOn && (
        <section className={`${card} p-5 space-y-2`}>
          <h3 className="text-[16px] font-bold text-[#0E1B3D] dark:text-white">You also have an online store</h3>
          <p className="text-[13.5px] text-[#4a5672] dark:text-slate-400">One domain opens one site. Choose what your own domain opens; the other stays on our free address.</p>
          <div className="flex flex-wrap gap-4 pt-1">
            {(['website', 'store'] as const).map((v) => (
              <label key={v} className="inline-flex items-center gap-2 text-[14px] font-semibold cursor-pointer">
                <input type="radio" name="domain-shows" checked={site.domainShows === v} disabled={!canEdit} onChange={() => set({ domainShows: v })} className="h-4 w-4 accent-[#1D5BEA]" /> {v === 'website' ? 'This website' : 'The online store'}
              </label>
            ))}
          </div>
        </section>
      )}

      {canEdit && (
        <div className="sticky bottom-3 z-10 flex justify-end">
          <button type="button" onClick={save} disabled={!dirty || busy === 'save'} className={`${primaryButton} shadow-lg disabled:opacity-60`}>
            {busy === 'save' && <Loader2 size={15} className="animate-spin" />} {dirty ? 'Save website' : 'Saved'}
          </button>
        </div>
      )}
    </div>
  )
}

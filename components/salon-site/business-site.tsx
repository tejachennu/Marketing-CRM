/**
 * The Front Desk business website (salon, clinic, studio, service centre), on WAMA's address (/v/<slug>) or the
 * business's own domain. A real business site: cover photo, Open now, services and prices with Book, offers and
 * memberships, team, photos, reviews, about, how to find us with a map and the week's hours, and a phone bar with
 * Call / WhatsApp / Book. The business's own colour (--c); no gradients. Server-rendered (fast, found by Google).
 */

import { AtSign, CalendarCheck, Clock, CreditCard, IdCard, MapPin, MessageCircle, Navigation, Phone, ShoppingBag, Star } from 'lucide-react'
import { planBenefits } from '@/lib/salon/membership-rules'
import { openStatus, weekRows, fromPrice, type SiteSettings } from '@/lib/salon/website'
import { ServicesMenu } from './services-menu'
import { BookButton } from './book-button'
import { BookingWizard } from '@/app/b/[slug]/booking-wizard'
import type { BookingPageView } from '@/lib/salon/booking-page'

export interface BusinessSiteProps {
  view: BookingPageView
  hours: { opens_at?: string | null; closes_at?: string | null; closed_weekdays?: number[] | null }
  site: SiteSettings
  average: number
  count: number
  reviews: { rating: number; comment: string; name: string; at: string }[]
  plans: any[]
  reviewLink: string | null
  storeLink: string | null
  /** The booking page on its own: /b/<slug> on WAMA, /book on the business's own domain */
  bookHref: string
  /** Days the booking form offers */
  days: string[]
  /** Start the booking form with this service / person picked (?s= / ?p=) */
  startService?: string | null
  startPerson?: string | null
  /** The connected Instagram account's latest posts (when switched on) */
  instagramPosts?: { id: string; image: string; link: string; caption: string }[]
  now?: number
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={size} className={i <= Math.round(value) ? 'fill-[#f5a524] text-[#f5a524]' : 'text-[#d5ddeb]'} />)}
    </span>
  )
}

function SectionHead({ id, kicker, title, children }: { id?: string; kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24 flex flex-wrap items-end gap-3 mb-6">
      <div className="mr-auto min-w-0">
        <p className="text-[12.5px] font-bold uppercase tracking-[0.14em] text-[var(--c)]">{kicker}</p>
        <h2 className="mt-1 text-[26px] sm:text-[32px] font-extrabold leading-tight text-[#0E1B3D]">{title}</h2>
      </div>
      {children}
    </div>
  )
}

export function BusinessSite({ view, hours, site, average, count, reviews, plans, reviewLink, storeLink, bookHref, days, startService = null, startPerson = null, instagramPosts = [], now = Date.now() }: BusinessSiteProps) {
  const phoneDigits = String(view.phone || '').replace(/\D/g, '')
  const callHref = phoneDigits.length >= 10 ? `tel:+${phoneDigits}` : null
  const waHref = phoneDigits.length >= 10 ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(`Hi ${view.business}`)}` : null
  const status = openStatus(hours, now)
  const week = weekRows(hours, now)
  const mapQuery = view.address ? encodeURIComponent(`${view.business}, ${view.address.replace(/\n/g, ', ')}`) : ''
  const directions = view.address ? `https://www.google.com/maps/search/?api=1&query=${mapQuery}` : null
  const showTeam = site.show.team && view.staff.length > 0
  const showPlans = site.show.memberships && plans.length > 0
  const showReviews = site.show.reviews && count > 0
  const startPrice = fromPrice(view.services.map((s) => s.price))
  const nav = [
    ['services', 'Services'],
    showPlans && ['offers', 'Memberships'],
    showTeam && ['team', 'Team'],
    (site.gallery.length > 0 || instagramPosts.length > 0) && ['photos', 'Photos'],
    showReviews && ['reviews', 'Reviews'],
    ['visit', 'Visit us'],
  ].filter(Boolean) as [string, string][]
  const showPhotos = site.gallery.length > 0 || instagramPosts.length > 0
  const payLine = !view.pay.online ? 'Pay at the shop after your visit.'
    : view.pay.mode === 'online' ? `Pay ${view.pay.advance === 100 ? '' : `a ${view.pay.advance}% advance `}online to book (${view.pay.methods}).`
    : `Pay online now (${view.pay.methods}) or at the shop.`
  const solid = 'inline-flex items-center justify-center gap-2 h-12 px-6 rounded-full text-[15px] font-bold'

  return (
    <div style={{ ['--c' as any]: site.colour }} className="min-h-screen bg-[#f7f8fb] text-[#0E1B3D] pb-16 md:pb-0">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-[#e3e8f2]">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-4">
          <a href="#top" className="flex items-center gap-2.5 min-w-0">
            {view.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view.logo} alt="" className="h-10 w-10 rounded-full object-cover border border-[#eef1f6] shrink-0" />
            ) : (
              <span className="h-10 w-10 shrink-0 rounded-full bg-[var(--c)] text-white flex items-center justify-center font-extrabold">{initials(view.business)}</span>
            )}
            <span className="font-extrabold text-[17px] truncate">{view.business}</span>
          </a>
          <nav aria-label="Sections" className="hidden lg:flex items-center gap-1 ml-auto text-[14px] font-semibold text-[#4a5672]">
            {nav.map(([id, label]) => <a key={id} href={`#${id}`} className="px-3 py-2 rounded-full hover:text-[var(--c)]">{label}</a>)}
          </nav>
          <div className="ml-auto lg:ml-2 flex items-center gap-2 shrink-0">
            {callHref && <a href={callHref} aria-label="Call" className="hidden sm:flex h-11 w-11 rounded-full border border-[#d5ddeb] items-center justify-center hover:border-[var(--c)]"><Phone size={18} /></a>}
            <a href="#book" className="h-11 px-5 rounded-full bg-[var(--c)] text-white font-bold text-[14.5px] inline-flex items-center gap-2"><CalendarCheck size={17} /> Book now</a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section id="top" className="relative bg-[#0E1B3D] text-white overflow-hidden">
        {site.cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={site.cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div className={`absolute inset-0 ${site.cover ? 'bg-black/55' : ''}`} aria-hidden />
        <div className={`relative max-w-6xl mx-auto px-4 ${site.cover ? 'py-20 sm:py-28' : 'py-14 sm:py-20'} ${site.cover ? '' : 'border-l-0'}`}>
          {!site.cover && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-2 bg-[var(--c)]" />}
          <div className="max-w-2xl">
            <p className={`inline-flex items-center gap-2 h-8 px-3 rounded-full text-[13px] font-bold ${status.open ? 'bg-white text-[#0E1B3D]' : 'bg-white/15 text-white'}`}>
              <span className={`h-2 w-2 rounded-full ${status.open ? 'bg-[var(--c)]' : 'bg-white/70'}`} aria-hidden /> {status.text}
            </p>
            <h1 className="mt-4 text-[34px] sm:text-[54px] font-extrabold leading-[1.05] tracking-tight break-words">{view.business}</h1>
            <p className="mt-3 text-[17px] sm:text-[20px] text-white/85 leading-snug">{site.tagline || 'Book your visit online in a minute: pick a service, a person and a free time.'}</p>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[14.5px] text-white/90">
              {count > 0 && <span className="inline-flex items-center gap-1.5"><Star size={16} className="fill-[#f5a524] text-[#f5a524]" /> <b>{average}</b> from {count} review{count === 1 ? '' : 's'}</span>}
              {startPrice > 0 && site.show.prices && <span>Services from <b>{rupees(startPrice)}</b></span>}
              {view.address && <span className="inline-flex items-center gap-1.5 min-w-0"><MapPin size={16} className="shrink-0" /> <span className="truncate max-w-[18rem]">{view.address.split('\n')[0]}</span></span>}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#book" className={`${solid} bg-white text-[#0E1B3D] hover:bg-[#f4f6fa]`}><CalendarCheck size={18} className="text-[var(--c)]" /> Book an appointment</a>
              {waHref && <a href={waHref} target="_blank" rel="noreferrer" className={`${solid} border-2 border-white/50 text-white hover:bg-white/10`}><MessageCircle size={18} /> WhatsApp us</a>}
            </div>
          </div>
        </div>
      </section>

      {/* Quick facts */}
      <div className="max-w-6xl mx-auto px-4 -mt-6 sm:-mt-8 relative z-10">
        <div className="bg-white rounded-2xl border border-[#e3e8f2] shadow-[0_8px_30px_rgba(14,27,61,0.08)] grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#eef1f6]">
          <div className="p-4 flex gap-3 items-center min-w-0"><span className="h-10 w-10 shrink-0 rounded-full bg-[var(--c)]/10 text-[var(--c)] flex items-center justify-center"><Clock size={19} /></span><span className="min-w-0"><span className="block text-[12px] font-bold uppercase tracking-wide text-[#8a94a8]">Today</span><span className="block text-[14.5px] font-bold truncate">{week.find((d) => d.today)?.time || '—'}</span></span></div>
          {view.address ? (
            <a href={directions!} target="_blank" rel="noreferrer" className="p-4 flex gap-3 items-center min-w-0 hover:bg-[#f7f8fb]"><span className="h-10 w-10 shrink-0 rounded-full bg-[var(--c)]/10 text-[var(--c)] flex items-center justify-center"><Navigation size={19} /></span><span className="min-w-0"><span className="block text-[12px] font-bold uppercase tracking-wide text-[#8a94a8]">Find us</span><span className="block text-[14.5px] font-bold truncate">{view.address.split('\n')[0]}</span></span></a>
          ) : <div className="hidden sm:block" />}
          {callHref ? (
            <a href={callHref} className="p-4 flex gap-3 items-center min-w-0 hover:bg-[#f7f8fb]"><span className="h-10 w-10 shrink-0 rounded-full bg-[var(--c)]/10 text-[var(--c)] flex items-center justify-center"><Phone size={19} /></span><span className="min-w-0"><span className="block text-[12px] font-bold uppercase tracking-wide text-[#8a94a8]">Call us</span><span className="block text-[14.5px] font-bold truncate">+{phoneDigits.replace(/^(\d{2})(\d{5})(\d+)$/, '$1 $2 $3')}</span></span></a>
          ) : <div className="hidden sm:block" />}
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-14 sm:py-20 space-y-20 sm:space-y-24">
        {/* Services */}
        <section aria-labelledby="services-title">
          <SectionHead id="services" kicker="What we do" title="Services and prices">
            <a href="#book" className="h-10 px-4 rounded-full bg-[var(--c)] text-white text-[14px] font-bold inline-flex items-center gap-2"><CalendarCheck size={16} /> Book a visit</a>
          </SectionHead>
          <ServicesMenu services={view.services} showPrices={site.show.prices} money="INR" />
        </section>

        {/* Book online, right here: live free times, and pay online or at the shop */}
        <section aria-labelledby="book-title">
          <SectionHead id="book" kicker="Book online" title="Book your visit" />
          <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
            <div className="min-w-0 max-w-2xl">
              <BookingWizard page={view} days={days} startService={startService} startPerson={startPerson} embedded colour={site.colour} />
            </div>
            <aside className="bg-white rounded-2xl border border-[#e3e8f2] p-5 space-y-4 lg:sticky lg:top-24">
              <div className="flex gap-3">
                <Clock size={19} className="shrink-0 mt-0.5 text-[var(--c)]" />
                <div className="min-w-0 text-[14px]">
                  <p className={`font-bold ${status.open ? 'text-[#0E1B3D]' : 'text-[#4a5672]'}`}>{status.text}</p>
                  <p className="text-[#6B7894]">Pick any free time in the next 30 days.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <CreditCard size={19} className="shrink-0 mt-0.5 text-[var(--c)]" />
                <p className="min-w-0 text-[14px] text-[#4a5672]">{payLine}</p>
              </div>
              <div className="flex gap-3">
                <MessageCircle size={19} className="shrink-0 mt-0.5 text-[var(--c)]" />
                <p className="min-w-0 text-[14px] text-[#4a5672]">{view.approval ? `${view.business} confirms your time on WhatsApp.` : 'Your booking is confirmed at once, on WhatsApp.'}</p>
              </div>
              <a href={bookHref} className="block text-[13px] font-semibold text-[var(--c)] hover:underline">Open the booking page on its own</a>
            </aside>
          </div>
        </section>

        {showPlans && (
          <section>
            <SectionHead id="offers" kicker="Save more" title="Memberships" />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {plans.map((p: any) => (
                <div key={p.name} className="bg-white rounded-2xl border border-[#e3e8f2] p-5 flex flex-col">
                  <div className="flex items-center gap-2"><IdCard size={20} className="text-[var(--c)]" /><p className="text-[17px] font-extrabold">{p.name}</p></div>
                  <p className="mt-2 text-[28px] font-extrabold">{rupees(Number(p.price) || 0)}</p>
                  {Number(p.validity_days) > 0 && <p className="text-[13px] text-[#6B7894]">Valid for {p.validity_days} days</p>}
                  <ul className="mt-3 space-y-1.5 text-[14px] text-[#4a5672] flex-1">
                    {planBenefits({ credit: Number(p.credit) || 0, discount_percent: Number(p.discount_percent) || 0, sessions: p.sessions || [], validity_days: Number(p.validity_days) || 0 }).map((b) => <li key={b} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-[var(--c)] shrink-0" aria-hidden />{b}</li>)}
                  </ul>
                  {waHref && <a href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(`Hi ${view.business}, I would like the ${p.name} membership.`)}`} target="_blank" rel="noreferrer" className="mt-4 h-10 rounded-full border-2 border-[var(--c)] text-[var(--c)] text-[14px] font-bold inline-flex items-center justify-center">Ask about it</a>}
                </div>
              ))}
            </div>
          </section>
        )}

        {showTeam && (
          <section>
            <SectionHead id="team" kicker="Our people" title="Meet the team" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {view.staff.map((m) => (
                <div key={m.id} className="bg-white rounded-2xl border border-[#e3e8f2] p-5 text-center">
                  <span className="mx-auto h-20 w-20 rounded-full bg-[var(--c)]/10 text-[var(--c)] flex items-center justify-center text-[24px] font-extrabold">{initials(m.name)}</span>
                  <p className="mt-3 text-[16px] font-bold break-words">{m.name}</p>
                  <BookButton person={m.id} className="mt-3 inline-flex h-9 px-4 rounded-full border border-[#d5ddeb] text-[13px] font-bold items-center hover:border-[var(--c)] hover:text-[var(--c)]">Book with {m.name.split(' ')[0]}</BookButton>
                </div>
              ))}
            </div>
          </section>
        )}

        {showPhotos && (
          <section>
            <SectionHead id="photos" kicker="Take a look" title="Photos">
              {site.instagram && <a href={`https://www.instagram.com/${site.instagram}/`} target="_blank" rel="noreferrer" className="h-10 px-4 rounded-full border border-[#d5ddeb] bg-white text-[14px] font-bold inline-flex items-center gap-2"><AtSign size={16} /> @{site.instagram}</a>}
            </SectionHead>
            {site.gallery.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {site.gallery.map((src, i) => (
                  <a key={src} href={src} target="_blank" rel="noreferrer" className={`block overflow-hidden rounded-xl bg-[#eef1f6] ${i === 0 ? 'col-span-2 row-span-2' : ''}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`${view.business} photo ${i + 1}`} loading="lazy" className="h-full w-full aspect-square object-cover hover:scale-[1.03] transition-transform" />
                  </a>
                ))}
              </div>
            )}
            {instagramPosts.length > 0 && (
              <div className={site.gallery.length > 0 ? 'mt-10' : ''}>
                <h3 className="text-[17px] font-extrabold flex items-center gap-2"><AtSign size={18} className="text-[var(--c)]" /> Latest on Instagram</h3>
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {instagramPosts.map((post) => (
                    <a key={post.id} href={post.link} target="_blank" rel="noreferrer" title={post.caption || 'See on Instagram'} className="group relative block overflow-hidden rounded-xl bg-[#eef1f6]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={post.image} alt={post.caption ? post.caption.slice(0, 100) : `${view.business} on Instagram`} loading="lazy" className="w-full aspect-square object-cover group-hover:scale-[1.03] transition-transform" />
                      {post.caption && <span className="absolute inset-x-0 bottom-0 bg-[#0E1B3D]/75 text-white text-[12px] leading-snug px-2.5 py-2 line-clamp-2">{post.caption}</span>}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {showReviews && (
          <section>
            <SectionHead id="reviews" kicker="What customers say" title="Reviews">
              {reviewLink && <a href={reviewLink} target="_blank" rel="noreferrer" className="h-10 px-4 rounded-full border border-[#d5ddeb] bg-white text-[14px] font-bold inline-flex items-center gap-2"><Star size={16} /> Review us on Google</a>}
            </SectionHead>
            <div className="grid lg:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
              <div className="bg-white rounded-2xl border border-[#e3e8f2] p-6 text-center">
                <p className="text-[52px] font-extrabold leading-none">{average.toFixed(1)}</p>
                <div className="mt-2"><Stars value={average} size={20} /></div>
                <p className="mt-2 text-[14px] text-[#6B7894]">from {count} review{count === 1 ? '' : 's'}</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {reviews.map((r, i) => (
                  <figure key={i} className="bg-white rounded-2xl border border-[#e3e8f2] p-5">
                    <Stars value={r.rating} />
                    <blockquote className="mt-2 text-[15px] leading-relaxed text-[#0E1B3D]">“{r.comment}”</blockquote>
                    <figcaption className="mt-3 text-[13.5px] font-bold text-[#4a5672]">{r.name}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}

        {site.about && (
          <section className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-8 items-center">
            <div>
              <SectionHead kicker="About us" title={`About ${view.business}`} />
              <p className="text-[16px] leading-relaxed text-[#4a5672] whitespace-pre-line">{site.about}</p>
            </div>
            {site.gallery[1] || site.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={site.gallery[1] || site.cover} alt="" loading="lazy" className="w-full aspect-[4/3] object-cover rounded-2xl" />
            ) : null}
          </section>
        )}

        {/* Visit us */}
        <section>
          <SectionHead id="visit" kicker="Find us" title="Visit us" />
          <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
            <div className="rounded-2xl overflow-hidden border border-[#e3e8f2] bg-[#eef1f6] min-h-[280px]">
              {view.address ? (
                <iframe title={`Map to ${view.business}`} src={`https://maps.google.com/maps?q=${mapQuery}&output=embed`} loading="lazy" className="w-full h-full min-h-[280px] lg:min-h-[380px] border-0" referrerPolicy="no-referrer-when-downgrade" />
              ) : (
                <div className="h-full min-h-[280px] flex items-center justify-center text-[#8a94a8]"><MapPin size={36} /></div>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-[#e3e8f2] p-5 sm:p-6 space-y-5">
              {view.address && (
                <div>
                  <p className="text-[12px] font-bold uppercase tracking-wide text-[#8a94a8]">Address</p>
                  <p className="mt-1 text-[15px] whitespace-pre-line">{view.address}</p>
                  <a href={directions!} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[14px] font-bold text-[var(--c)]"><Navigation size={15} /> Get directions</a>
                </div>
              )}
              <div>
                <p className="text-[12px] font-bold uppercase tracking-wide text-[#8a94a8]">Opening hours</p>
                <ul className="mt-2 space-y-1.5 text-[14.5px]">
                  {week.map((d) => (
                    <li key={d.day} className={`flex justify-between gap-3 ${d.today ? 'font-bold text-[#0E1B3D]' : 'text-[#4a5672]'}`}>
                      <span>{d.day}{d.today ? ' (today)' : ''}</span><span className={d.closed ? 'text-[#8a94a8]' : ''}>{d.time}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                {callHref && <a href={callHref} className="h-10 px-4 rounded-full border border-[#d5ddeb] text-[14px] font-bold inline-flex items-center gap-2"><Phone size={16} /> Call</a>}
                {waHref && <a href={waHref} target="_blank" rel="noreferrer" className="h-10 px-4 rounded-full bg-[#25D366] text-white text-[14px] font-bold inline-flex items-center gap-2"><MessageCircle size={16} /> WhatsApp</a>}
              </div>
            </div>
          </div>
        </section>

        {/* Last call to book */}
        <section className="rounded-2xl bg-[var(--c)] text-white p-8 sm:p-12 flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="flex-1 min-w-0">
            <h2 className="text-[26px] sm:text-[32px] font-extrabold leading-tight">Ready for your visit?</h2>
            <p className="mt-1 text-[16px] text-white/85">Pick a service and a free time. It takes a minute.</p>
          </div>
          <a href="#book" className={`${solid} bg-white text-[#0E1B3D] shrink-0`}><CalendarCheck size={18} className="text-[var(--c)]" /> Book now</a>
        </section>
      </main>

      <footer className="bg-[#0E1B3D] text-white/85">
        <div className="max-w-6xl mx-auto px-4 py-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 text-[14px]">
          <div className="lg:col-span-2">
            <p className="text-[19px] font-extrabold text-white">{view.business}</p>
            {site.tagline && <p className="mt-2 text-white/70 max-w-md">{site.tagline}</p>}
            {view.address && <p className="mt-3 flex gap-2 text-white/75"><MapPin size={16} className="shrink-0 mt-0.5" /><span className="whitespace-pre-line">{view.address}</span></p>}
          </div>
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wide text-white/55">Visit</p>
            <ul className="mt-3 space-y-2">
              <li><a href="#book" className="hover:underline">Book an appointment</a></li>
              <li><a href="#services" className="hover:underline">Services and prices</a></li>
              {storeLink && <li><a href={storeLink} className="hover:underline inline-flex items-center gap-1.5"><ShoppingBag size={14} /> Shop online</a></li>}
            </ul>
          </div>
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wide text-white/55">Contact</p>
            <ul className="mt-3 space-y-2">
              {callHref && <li><a href={callHref} className="hover:underline">Call us</a></li>}
              {waHref && <li><a href={waHref} target="_blank" rel="noreferrer" className="hover:underline">WhatsApp</a></li>}
              {site.instagram && <li><a href={`https://www.instagram.com/${site.instagram}/`} target="_blank" rel="noreferrer" className="hover:underline">Instagram</a></li>}
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10">
          <p className="max-w-6xl mx-auto px-4 py-4 text-[12.5px] text-white/50 flex flex-wrap justify-between gap-2">
            <span>© {new Date(now).getFullYear()} {view.business}</span><span>Website by WAMA CRM</span>
          </p>
        </div>
      </footer>

      {/* Phones: Call · WhatsApp · Book now */}
      <nav aria-label="Quick actions" className="md:hidden fixed bottom-0 inset-x-0 z-30 h-16 bg-white border-t border-[#e3e8f2] grid grid-cols-4 shadow-[0_-2px_10px_rgba(14,27,61,0.08)]">
        {callHref ? <a href={callHref} className="flex flex-col items-center justify-center gap-0.5 text-[11.5px] font-bold"><Phone size={20} /> Call</a> : <span />}
        {waHref ? <a href={waHref} target="_blank" rel="noreferrer" className="flex flex-col items-center justify-center gap-0.5 text-[11.5px] font-bold"><MessageCircle size={20} /> WhatsApp</a> : <span />}
        <a href="#book" className="col-span-2 m-2 rounded-xl bg-[var(--c)] text-white flex items-center justify-center gap-2 text-[15px] font-extrabold"><CalendarCheck size={18} /> Book now</a>
      </nav>
    </div>
  )
}

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CalendarCheck, Clock, IdCard, MapPin, MessageCircle, Phone, Star, Check } from 'lucide-react'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadBookingPage, publicView } from '@/lib/salon/booking-page'
import { formatRupees } from '@/lib/salon/invoice'
import { planBenefits } from '@/lib/salon/membership-rules'

export const dynamic = 'force-dynamic'

async function load(slug: string) {
  const db = getSupabaseAdminClient()
  const page = await loadBookingPage(db, slug).catch(() => null)
  if (!page) return null
  const [feedback, plans] = await Promise.all([
    db.from('salon_feedback').select('rating, comment, customer_name, created_at').eq('organization_id', page.organization.id).order('created_at', { ascending: false }).limit(500),
    db.from('salon_membership_plans').select('name, price, validity_days, discount_percent, credit, sessions, colour').eq('organization_id', page.organization.id).eq('active', true).order('price'),
  ])
  const ratings = (feedback.data || []) as { rating: number; comment: string | null; customer_name: string | null; created_at: string }[]
  const average = ratings.length ? Math.round((ratings.reduce((s, r) => s + r.rating, 0) / ratings.length) * 10) / 10 : 0
  // Good reviews with words, first name only
  const reviews = ratings.filter((r) => r.rating >= 4 && String(r.comment || '').trim().length >= 8).slice(0, 6)
    .map((r) => ({ rating: r.rating, comment: String(r.comment).trim().slice(0, 280), name: String(r.customer_name || 'A customer').split(' ')[0], at: r.created_at }))
  return { page, view: publicView(page), average, count: ratings.length, reviews, plans: plans.error ? [] : plans.data || [] }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const data = await load(slug)
  if (!data) return { title: 'Not found' }
  const { view } = data
  const description = `${view.business}${view.address ? `, ${view.address.split('\n')[0]}` : ''}. ${view.services.length} services. Book online in a minute.`
  return { title: view.business, description, openGraph: { title: view.business, description, ...(view.logo ? { images: [view.logo] } : {}) } }
}

/** A business's own page: who they are, services and prices, team, memberships, reviews, hours, and Book now. */
export default async function BusinessLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = await load(slug)
  if (!data) notFound()
  const { view, average, count, reviews, plans } = data
  const book = `/b/${view.slug}`
  const phoneDigits = String(view.phone || '').replace(/\D/g, '')
  const categories = [...new Set(view.services.map((s) => s.category))]
  const mapLink = view.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${view.business}, ${view.address}`)}` : null
  const button = 'inline-flex items-center justify-center gap-2 h-12 px-6 rounded-full text-[15px] font-bold'

  return (
    <main className="min-h-screen bg-[#f4f6fa] text-[#0E1B3D]">
      <header className="sticky top-0 z-20 bg-white border-b border-[#e3e8f2]">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-3">
          {view.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={view.logo} alt="" className="h-10 w-10 rounded-full object-cover border border-[#eef1f6]" />
          ) : (
            <span className="h-10 w-10 rounded-full bg-[#0E1B3D] text-white flex items-center justify-center font-bold">{view.business.slice(0, 1)}</span>
          )}
          <p className="font-extrabold text-[17px] truncate flex-1 min-w-0">{view.business}</p>
          {phoneDigits.length >= 10 && <a href={`tel:+${phoneDigits}`} aria-label="Call" className="h-11 w-11 shrink-0 rounded-full border border-[#d5ddeb] flex items-center justify-center"><Phone size={18} /></a>}
          <a href={book} className="h-11 px-5 shrink-0 rounded-full bg-[#1D5BEA] text-white font-bold text-[14.5px] inline-flex items-center gap-2"><CalendarCheck size={17} /> <span className="hidden min-[380px]:inline">Book now</span><span className="min-[380px]:hidden">Book</span></a>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-[#0E1B3D] text-white relative overflow-hidden">
        <span aria-hidden="true" className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/5" />
        <span aria-hidden="true" className="absolute right-24 -bottom-28 h-56 w-56 rounded-full bg-white/5" />
        <div className="relative max-w-5xl mx-auto px-4 py-12 sm:py-16">
          <h1 className="text-[30px] sm:text-[44px] font-extrabold leading-tight max-w-2xl break-words">{view.business}</h1>
          <p className="mt-3 text-[16px] sm:text-[18px] text-white/85 max-w-xl">Book your visit online in a minute: pick a service, a person and a free time.</p>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[14.5px] text-white/90">
            {count > 0 && <span className="inline-flex items-center gap-1.5"><Star size={16} className="fill-white" /> {average} from {count} review{count === 1 ? '' : 's'}</span>}
            {view.hours && <span className="inline-flex items-center gap-1.5"><Clock size={16} /> {view.hours}</span>}
            {view.address && <span className="inline-flex items-center gap-1.5 min-w-0"><MapPin size={16} className="shrink-0" /> <span className="truncate max-w-[18rem]">{view.address.split('\n')[0]}</span></span>}
          </div>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href={book} className={`${button} bg-white text-[#0E1B3D]`}><CalendarCheck size={18} /> Book an appointment</a>
            {phoneDigits.length >= 10 && <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer" className={`${button} border-2 border-white/40 text-white`}><MessageCircle size={18} /> WhatsApp us</a>}
          </div>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 py-10 space-y-12 pb-28 sm:pb-12">
        {/* Services */}
        <section aria-labelledby="services">
          <h2 id="services" className="text-[24px] font-extrabold">Services and prices</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {categories.map((category) => (
              <div key={category} className="bg-white rounded-2xl border border-[#e3e8f2] p-5">
                <h3 className="text-[13px] font-bold uppercase tracking-wide text-[#6B7894]">{category}</h3>
                <ul className="mt-2 divide-y divide-[#eef1f6]">
                  {view.services.filter((s) => s.category === category).map((s) => (
                    <li key={s.id} className="py-3 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold break-words">{s.name}</p>
                        <p className="text-[13px] text-[#6B7894]">{s.minutes} min</p>
                      </div>
                      <p className="font-extrabold shrink-0">{formatRupees(s.price)}</p>
                      <a href={`${book}?s=${s.id}`} className="h-9 px-4 shrink-0 rounded-full border-2 border-[#1D5BEA] text-[#1D5BEA] text-[13.5px] font-bold inline-flex items-center">Book</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Team */}
        {view.staff.length > 0 && (
          <section aria-labelledby="team">
            <h2 id="team" className="text-[24px] font-extrabold">Our team</h2>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {view.staff.map((m) => (
                <a key={m.id} href={`${book}?p=${m.id}`} className="bg-white rounded-2xl border border-[#e3e8f2] p-4 text-center hover:border-[#1D5BEA]">
                  <span className="mx-auto h-14 w-14 rounded-full bg-[#eef1f6] text-[#0E1B3D] flex items-center justify-center text-[20px] font-extrabold">{m.name.slice(0, 1).toUpperCase()}</span>
                  <p className="mt-2 font-bold truncate">{m.name}</p>
                  <p className="text-[12.5px] text-[#1D5BEA] font-semibold">Book with {m.name.split(' ')[0]}</p>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Memberships */}
        {plans.length > 0 && (
          <section aria-labelledby="memberships">
            <h2 id="memberships" className="text-[24px] font-extrabold">Memberships</h2>
            <p className="mt-1 text-[15px] text-[#4a5672]">Save on every visit. Ask at the counter or on WhatsApp to join.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((p: any) => (
                <div key={p.name} className="bg-white rounded-2xl border border-[#e3e8f2] overflow-hidden">
                  <div style={{ background: p.colour || '#0E1B3D' }} className="px-5 py-4 text-white">
                    <p className="inline-flex items-center gap-2 font-extrabold text-[18px]"><IdCard size={18} /> {p.name}</p>
                    <p className="text-[24px] font-extrabold">{formatRupees(Number(p.price) || 0)}</p>
                  </div>
                  <ul className="p-5 space-y-1.5 text-[14.5px] text-[#4a5672]">
                    {planBenefits({ credit: Number(p.credit) || 0, discount_percent: Number(p.discount_percent) || 0, sessions: p.sessions || [], validity_days: Number(p.validity_days) || 0 }).map((b) => (
                      <li key={b} className="flex gap-2"><Check size={16} className="shrink-0 mt-0.5 text-[#1D5BEA]" /> {b}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Reviews */}
        {reviews.length > 0 && (
          <section aria-labelledby="reviews">
            <h2 id="reviews" className="text-[24px] font-extrabold">What customers say</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {reviews.map((r, i) => (
                <figure key={i} className="bg-white rounded-2xl border border-[#e3e8f2] p-5">
                  <span className="inline-flex gap-0.5" role="img" aria-label={`${r.rating} out of 5 stars`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={15} className={n <= r.rating ? 'fill-[#0E1B3D] text-[#0E1B3D]' : 'text-[#d5ddeb]'} />)}</span>
                  <blockquote className="mt-2 text-[15px] text-[#0E1B3D] break-words">“{r.comment}”</blockquote>
                  <figcaption className="mt-2 text-[13px] text-[#6B7894]">{r.name}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* Visit us */}
        <section aria-labelledby="visit" className="bg-white rounded-2xl border border-[#e3e8f2] p-6 grid gap-6 md:grid-cols-2">
          <div>
            <h2 id="visit" className="text-[24px] font-extrabold">Visit us</h2>
            {view.address && <p className="mt-3 text-[15px] text-[#4a5672] whitespace-pre-line flex gap-2"><MapPin size={18} className="shrink-0 mt-0.5 text-[#1D5BEA]" /> {view.address}</p>}
            {view.hours && <p className="mt-2 text-[15px] text-[#4a5672] flex gap-2"><Clock size={18} className="shrink-0 mt-0.5 text-[#1D5BEA]" /> {view.hours}</p>}
            {view.phone && <p className="mt-2 text-[15px] flex gap-2"><Phone size={18} className="shrink-0 mt-0.5 text-[#1D5BEA]" /> <a href={`tel:+${phoneDigits}`} className="font-semibold">{view.phone}</a></p>}
          </div>
          <div className="flex flex-col gap-3 md:items-end md:justify-center">
            <a href={book} className={`${button} bg-[#1D5BEA] text-white w-full md:w-auto`}><CalendarCheck size={18} /> Book an appointment</a>
            {mapLink && <a href={mapLink} target="_blank" rel="noreferrer" className={`${button} border-2 border-[#d5ddeb] w-full md:w-auto`}><MapPin size={18} /> Get directions</a>}
          </div>
        </section>
      </div>

      {/* Phones: Book always at hand */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-[#e3e8f2] p-3 flex gap-2">
        {phoneDigits.length >= 10 && <a href={`tel:+${phoneDigits}`} className="h-12 w-12 shrink-0 rounded-full border border-[#d5ddeb] flex items-center justify-center" aria-label="Call"><Phone size={19} /></a>}
        <a href={book} className="flex-1 h-12 rounded-full bg-[#1D5BEA] text-white font-bold text-[15px] inline-flex items-center justify-center gap-2"><CalendarCheck size={18} /> Book an appointment</a>
      </div>
      <p className="pb-24 sm:pb-8 text-center text-[12.5px] text-[#8a94a8]">Online bookings by WAMA CRM</p>
    </main>
  )
}

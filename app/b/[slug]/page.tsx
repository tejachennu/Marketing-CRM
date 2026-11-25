import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { bookableDays, loadBookingPage, publicView } from '@/lib/salon/booking-page'
import { BookingWizard } from './booking-wizard'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const page = await loadBookingPage(getSupabaseAdminClient(), slug).catch(() => null)
  const name = page ? page.setup.settings.business_name || page.organization.name : 'Book online'
  // A business that has switched appointments off: the page says so (with Call / WhatsApp), so no "Book" in the title
  if (page && page.bookings === false) return { title: name, description: `${name} is not taking online bookings. Walk in during opening hours, or call or WhatsApp them.` }
  return { title: `Book at ${name}`, description: `Book your visit at ${name} online. Pick a service, a time, and you are done.` }
}

/** The public booking page: /b/<workspace slug>, ?p=<person> or ?s=<service> to start with one picked. */
export default async function BookingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ p?: string; s?: string }> }) {
  const { slug } = await params
  const query = await searchParams
  const page = await loadBookingPage(getSupabaseAdminClient(), slug)
  if (!page) notFound()
  const view = publicView(page)
  return (
    <main className="min-h-screen bg-[#f4f6fa] text-[#0E1B3D]">
      <BookingWizard
        page={view}
        days={bookableDays(page.setup.settings)}
        startService={view.services.some((s) => s.id === query.s) ? query.s! : null}
        startPerson={view.staff.some((m) => m.id === query.p) ? query.p! : null}
      />
      <p className="pb-8 text-center text-[12.5px] text-[#8a94a8]">Bookings by WAMA CRM</p>
    </main>
  )
}

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { bookableDays, loadBookingPage, publicView } from '@/lib/salon/booking-page'
import { domainSite } from '@/lib/salon/website-store'
import { BookingWizard } from '../../../b/[slug]/booking-wizard'

export const dynamic = 'force-dynamic'

/** The booking page on a business's own domain (/book), for the Front Desk website there. */
async function load(domain: string) {
  const db = getSupabaseAdminClient()
  const target = await domainSite(db, domain).catch(() => null)
  return target ? loadBookingPage(db, target.slug).catch(() => null) : null
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const page = await load(slug)
  const name = page ? page.setup.settings.business_name || page.organization.name : 'Book online'
  return { title: `Book at ${name}`, description: `Book your visit at ${name} online. Pick a service, a time, and you are done.` }
}

export default async function OwnDomainBooking({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ p?: string; s?: string }> }) {
  const { slug } = await params
  const query = await searchParams
  const page = await load(slug)
  if (!page) notFound()
  const view = publicView(page)
  return (
    <main className="min-h-screen bg-[#f4f6fa] text-[#0E1B3D]">
      <BookingWizard page={view} days={bookableDays(page.setup.settings)} startService={view.services.some((s) => s.id === query.s) ? query.s! : null} startPerson={view.staff.some((m) => m.id === query.p) ? query.p! : null} />
      <p className="pb-8 text-center text-[13px]"><a href="/" className="font-semibold text-[#1D5BEA]">Back to {view.business}</a></p>
    </main>
  )
}

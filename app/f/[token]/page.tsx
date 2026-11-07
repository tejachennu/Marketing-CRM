import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { staffOnInvoice } from '@/lib/salon/feedback'
import { isSafeLogoUrl } from '@/lib/salon/logo'
import { formatIstDay, istDate } from '@/lib/salon/spoken'
import { FeedbackForm } from './feedback-form'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Your feedback', robots: { index: false, follow: false } }

export default async function FeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound()
  const db = getSupabaseAdminClient()
  const { data: invoice } = await db.from('salon_invoices').select('*').eq('public_token', token).maybeSingle()
  if (!invoice) notFound()
  // The logo the bill was issued with, else the salon's current one
  let logo: string | null = isSafeLogoUrl(invoice.business?.logo_url) ? invoice.business.logo_url : null
  const [{ data: existing }, { data: settings }] = await Promise.all([
    db.from('salon_feedback').select('rating, staff_ratings, tags, comment').eq('invoice_id', invoice.id).maybeSingle(),
    db.from('salon_settings').select('*').eq('organization_id', invoice.organization_id).maybeSingle(),
  ])
  if (!logo && !('logo_url' in (invoice.business || {})) && isSafeLogoUrl(settings?.logo_url)) logo = settings.logo_url
  const services = [...new Set((invoice.items || []).map((item: any) => item?.name).filter(Boolean))] as string[]
  const firstName = String(invoice.customer_name || '').trim().split(/\s+/)[0]

  return (
    <main className="min-h-screen bg-[#f6f8fc] text-[#0E1B3D] px-4 py-6 sm:py-10">
      <FeedbackForm
        token={token}
        business={invoice.business?.name || settings?.business_name || 'the salon'}
        logo={logo}
        customerName={firstName && firstName !== 'Walk-in' ? firstName : ''}
        services={services}
        billLabel={`${invoice.number} · ${formatIstDay(istDate(invoice.issued_at))}`}
        people={staffOnInvoice(invoice).map(({ key, name, services: did }) => ({ key, name, services: did }))}
        closed={invoice.status === 'void'}
        existing={existing ? { rating: existing.rating, staff_ratings: existing.staff_ratings || {}, tags: existing.tags || [], comment: existing.comment || '' } : null}
      />
      <p className="mt-6 text-center text-[12.5px] text-[#8a94a8]">Made with WAMA CRM</p>
    </main>
  )
}

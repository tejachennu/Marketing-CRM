import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore } from '@/lib/commerce/storefront'
import { ReviewForm } from './review-form'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Rate your order', robots: { index: false } }

/** The review page a customer opens from WhatsApp after delivery: /s/<slug>/review/<token>. */
export default async function ReviewPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params
  const page = await loadStore(getSupabaseAdminClient(), slug).catch(() => null)
  if (!page) notFound()
  return (
    <main className="min-h-screen bg-[#f4f6fa] text-[#0E1B3D]" style={{ ['--c' as any]: page.settings.colour }}>
      <div className="max-w-xl mx-auto px-4 py-6">
        <p className="text-[14px] font-semibold text-[#4a5672]">{page.organization.name}</p>
        <ReviewForm slug={page.organization.slug} token={token} />
      </div>
    </main>
  )
}

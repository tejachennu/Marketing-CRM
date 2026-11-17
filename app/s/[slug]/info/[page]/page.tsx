import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore } from '@/lib/commerce/storefront'
import { STORE_PAGE_TITLES, STORE_PAGES, isPageKey, pageText } from '@/lib/commerce/store-pages'
import { storeBase } from '@/lib/commerce/store-seo'

export const dynamic = 'force-dynamic'

async function load(slug: string, key: string) {
  if (!isPageKey(key)) return null
  const page = await loadStore(getSupabaseAdminClient(), slug).catch(() => null)
  if (!page) return null
  const s = page.settings
  const text = pageText(key, s.pages, { name: page.organization.name, about: s.about, phone: s.phone, whatsapp: s.whatsapp, address: s.address })
  return text ? { page, key, text } : null
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; page: string }> }): Promise<Metadata> {
  const { slug, page: key } = await params
  const found = await load(slug, key)
  if (!found) return { title: 'Store' }
  const title = `${STORE_PAGE_TITLES[found.key]} · ${found.page.organization.name}`
  const ownDomain = (await headers()).get('x-store-via-domain') === '1'
  return { title, description: found.text.slice(0, 160), alternates: { canonical: `${storeBase(found.page, ownDomain)}/info/${found.key}` } }
}

/** An info or policy page of a store: /s/<slug>/info/<about|shipping|returns|terms|privacy|contact>. */
export default async function StoreInfoPage({ params }: { params: Promise<{ slug: string; page: string }> }) {
  const { slug, page: key } = await params
  const found = await load(slug, key)
  if (!found) notFound()
  const { page, text } = found
  const ownDomain = (await headers()).get('x-store-via-domain') === '1'
  const base = ownDomain ? '' : `/s/${page.organization.slug}`
  const others = STORE_PAGES.filter((k) => k !== found.key && pageText(k, page.settings.pages, { name: page.organization.name, about: page.settings.about, phone: page.settings.phone, whatsapp: page.settings.whatsapp, address: page.settings.address }))
  return (
    <main className="min-h-screen bg-[#f4f6fa] text-[#0E1B3D]" style={{ ['--c' as any]: page.settings.colour }}>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <a href={base || '/'} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#4a5672] hover:text-[var(--c)]"><ArrowLeft size={16} /> {page.organization.name}</a>
        <article className="mt-4 bg-white rounded-2xl border border-[#e3e8f2] p-5 sm:p-8">
          <h1 className="text-[24px] sm:text-[28px] font-extrabold leading-tight">{STORE_PAGE_TITLES[found.key]}</h1>
          <div className="mt-4 space-y-4 text-[15.5px] leading-relaxed text-[#4a5672]">
            {text.split(/\n{2,}/).map((para, i) => <p key={i} className="whitespace-pre-line break-words">{para}</p>)}
          </div>
        </article>
        {others.length > 0 && (
          <nav aria-label="More pages" className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-[14px]">
            {others.map((k) => <a key={k} href={`${base}/info/${k}`} className="font-semibold text-[#4a5672] underline hover:text-[var(--c)]">{STORE_PAGE_TITLES[k]}</a>)}
          </nav>
        )}
      </div>
    </main>
  )
}

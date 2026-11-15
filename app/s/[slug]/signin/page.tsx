import { notFound } from 'next/navigation'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { loadStore } from '@/lib/commerce/storefront'
import { ShopperSignIn } from './signin-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign in', robots: { index: false } }

/** Google sign-in for a store's customers. Always runs on WAMA's own address, then returns to the store. */
export default async function StoreSignInPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = await loadStore(getSupabaseAdminClient(), slug)
  if (!page || !page.settings.accounts) notFound()
  return <ShopperSignIn slug={page.organization.slug} name={page.organization.name} colour={page.settings.colour} domain={page.organization.domain} />
}

'use client'

/**
 * The store's AI chat (Website settings → AI chat on your website): the shared website chat (components/site-chat)
 * set up for the store: product cards with Add to cart, "Track my order" (a signed-in shopper's own orders, or order
 * number + phone), and the shop's WhatsApp for anything it cannot do. Answers come from POST /api/public/store/[slug]/chat.
 */

import { SiteChat } from '@/components/site-chat/site-chat'

export function StoreChat({ slug, storeName, logo, whatsapp, phone, money, productHref, onAdd, raised, authHeaders }: {
  slug: string; storeName: string; logo?: string | null; whatsapp: string; phone?: string | null; money: (n: number) => string; productHref: (id: string) => string
  onAdd: (id: string) => void; raised: boolean; authHeaders?: () => Record<string, string>
}) {
  return (
    <SiteChat kind="store" endpoint={`/api/public/store/${slug}/chat`} storageKey={`store-chat:${slug}`} name={storeName} logo={logo}
      whatsapp={whatsapp} phone={phone} money={money} productHref={productHref} onAdd={onAdd} raised={raised} authHeaders={authHeaders} />
  )
}

'use client'

import Link from 'next/link'
import { ExternalLink, LayoutGrid, Package, ShoppingCart } from 'lucide-react'
import type { ChatOrderCard, ChatProductCard, CommerceMessage } from '@/lib/chat-commerce'
import { ORDER_STATUS_LABELS, formatMoney, type OrderStatus } from '@/lib/commerce/commerce-utils'

/** The picture of a product, or a tile with its name when it has none (as WhatsApp shows it). */
function ProductImage({ src, title, className }: { src?: string | null; title: string; className: string }) {
  if (src) {
    // Catalog images come from arbitrary hosts, so a plain img is used rather than next/image
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={title} loading="lazy" className={`${className} object-cover bg-black/5`} />
  }
  return (
    <div className={`${className} bg-[#107569] text-white flex items-center justify-center text-center px-3 font-light leading-tight`}>
      {title ? <span className="line-clamp-3">{title}</span> : <ShoppingCart size={22} className="opacity-90" />}
    </div>
  )
}

const STATUS_TONES: Record<string, string> = {
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  cod_confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  shipped: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  delivered: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  canceled: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
}

export function CommerceCard({
  parsed,
  product,
  order,
  isOutgoing,
}: {
  parsed: CommerceMessage
  product?: ChatProductCard
  order?: ChatOrderCard
  isOutgoing: boolean
}) {
  const panel = isOutgoing ? 'bg-black/[0.05] dark:bg-black/20' : 'bg-[#f0f2f5] dark:bg-black/20'

  if (parsed.kind === 'product') {
    const title = product?.title || parsed.title || (parsed.sku ? `SKU ${parsed.sku}` : 'Product')
    return (
      <div className="w-[240px] sm:w-[260px] max-w-full">
        <ProductImage src={product?.image_url} title={title} className="w-full aspect-square rounded-md text-[22px]" />
        <div className={`mt-1 rounded-md px-2.5 py-2 ${panel}`}>
          <div className="text-[14px] font-medium leading-snug line-clamp-2">{title}</div>
          {product && <div className="text-[13px] text-[#54656f] dark:text-[#aebac1] mt-0.5">{formatMoney(product.price, product.currency)}</div>}
        </div>
      </div>
    )
  }

  if (parsed.kind === 'order') {
    const items = order?.items || []
    const quantity = items.reduce((sum, item) => sum + item.quantity, 0) || parsed.itemCount
    const first = items[0]
    const statusLabel = order ? ORDER_STATUS_LABELS[order.status as OrderStatus] || order.status : null
    return (
      <div className="w-[260px] sm:w-[300px] max-w-full">
        <div className={`flex items-stretch rounded-md overflow-hidden ${panel}`}>
          <ProductImage src={first?.image_url} title={first?.title || ''} className="w-[72px] min-h-[72px] shrink-0 text-[11px]" />
          <div className="flex-1 min-w-0 px-3 py-2 flex flex-col justify-center">
            <div className="flex items-center gap-1.5 text-[14px] font-semibold">
              <ShoppingCart size={15} className="shrink-0" />
              {quantity} {quantity === 1 ? 'item' : 'items'}
            </div>
            {order && (
              <div className="text-[13px] text-[#54656f] dark:text-[#aebac1] mt-0.5">
                {formatMoney(order.total_amount, order.currency)} <span className="text-[12px]">(estimated total)</span>
              </div>
            )}
          </div>
        </div>

        {items.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 px-1 text-[12.5px] text-[#3b4a54] dark:text-[#d1d7db]">
            {items.slice(0, 3).map((item, index) => (
              <li key={index} className="flex justify-between gap-3">
                <span className="truncate">{item.quantity} × {item.title}</span>
                <span className="shrink-0 text-[#667781] dark:text-[#8696a0]">{formatMoney(item.unit_price * item.quantity, order?.currency)}</span>
              </li>
            ))}
            {items.length > 3 && <li className="text-[#667781] dark:text-[#8696a0]">+{items.length - 3} more</li>}
          </ul>
        )}

        {parsed.note && <p className="mt-1.5 px-1 text-[13px] italic text-[#3b4a54] dark:text-[#d1d7db]">“{parsed.note}”</p>}

        <div className="mt-1.5 pt-1.5 border-t border-black/10 dark:border-white/10 flex items-center justify-between gap-2 px-1">
          {order ? (
            <>
              <span className="text-[12px] font-semibold text-[#54656f] dark:text-[#aebac1] truncate">#{order.order_number}</span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS_TONES[order.status] || 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                {statusLabel}
              </span>
            </>
          ) : (
            <span className="text-[12px] text-[#667781] dark:text-[#8696a0]">WhatsApp cart</span>
          )}
        </div>
        <Link
          href="/dashboard/commerce"
          className="mt-1.5 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[13px] font-semibold text-[#008069] dark:text-[#00a884] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          <ExternalLink size={13} />
          View order
        </Link>
      </div>
    )
  }

  // Product lists, the catalog and website links: a compact labelled chip
  const label =
    parsed.kind === 'products' ? `${parsed.count} ${parsed.count === 1 ? 'product' : 'products'} from the catalog`
      : parsed.kind === 'catalog' ? 'Full catalog'
        : `Website link: ${parsed.title}`
  const Icon = parsed.kind === 'catalog' ? LayoutGrid : parsed.kind === 'website' ? ExternalLink : Package
  return (
    <div className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 min-w-[200px] ${panel}`}>
      <span className="h-9 w-9 shrink-0 rounded-md bg-[#107569] text-white flex items-center justify-center">
        <Icon size={17} />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-[#667781] dark:text-[#8696a0]">Sent</span>
        <span className="block text-[13.5px] font-medium leading-snug truncate">{label}</span>
      </span>
    </div>
  )
}

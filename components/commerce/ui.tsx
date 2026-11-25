'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ORDER_STATUS_LABELS, needsRefund, type OrderStatus } from '@/lib/commerce/commerce-utils'

// ── Shared styles for the store screens ──────────────────────────────────────
export const cardClass = 'bg-white dark:bg-[#111b21] rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-[0_1px_2px_rgba(11,20,26,0.05)]'
// Phones: 44 px tall and 16 px text (smaller text makes iPhones zoom in when the box is tapped)
export const inputClass =
  'w-full h-9 max-sm:h-11 px-3 text-[13px] max-sm:text-base rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#1D5BEA] focus:ring-2 focus:ring-[#1D5BEA]/20 disabled:opacity-60'
export const textareaClass = inputClass.replace('h-9 max-sm:h-11 ', '') + ' py-2 resize-y'
export const labelClass = 'block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1'
export const hintClass = 'text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 mt-1'
export const sectionTitle = 'text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5'
// Buttons are at least 44 px tall on phones, so a thumb can hit them
export const primaryButton =
  'inline-flex items-center justify-center gap-1.5 h-9 max-sm:min-h-11 px-4 rounded-lg bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-xs font-bold shadow-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'
export const secondaryButton =
  'inline-flex items-center justify-center gap-1.5 h-9 max-sm:min-h-11 px-3.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'
export const dangerButton =
  'inline-flex items-center justify-center gap-1.5 h-9 max-sm:min-h-11 px-3.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-[#fdf0f0] dark:hover:bg-red-950/30 border border-[#f5c9c9] dark:border-red-900/60 text-[#b91c1c] dark:text-red-300 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'
/** A square, bordered button holding only an icon (refresh, and the like). */
export const squareButton =
  'inline-flex items-center justify-center h-9 w-9 max-sm:h-11 max-sm:w-11 shrink-0 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
export const iconButton =
  'inline-flex items-center justify-center h-8 w-8 max-sm:h-11 max-sm:w-11 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'

export type ShowToast = (kind: 'success' | 'error', text: string) => void

// The palette only: waiting on the customer = outlined grey, ready to ship = light blue, on the way = blue,
// done = grey, canceled = faint grey (red is kept for refunds and failures)
const STATUS_STYLES: Record<OrderStatus, string> = {
  cart_submitted: 'bg-[#eef1f6] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300',
  awaiting_address: 'bg-white text-[#0E1B3D] ring-1 ring-inset ring-[#d5ddeb] dark:bg-transparent dark:text-slate-200 dark:ring-slate-600',
  payment_pending: 'bg-white text-[#0E1B3D] ring-1 ring-inset ring-[#d5ddeb] dark:bg-transparent dark:text-slate-200 dark:ring-slate-600',
  paid: 'bg-[#dfe8fd] text-[#163d9c] dark:bg-[#0E1B3D] dark:text-[#9db5ef]',
  cod_confirmed: 'bg-[#dfe8fd] text-[#163d9c] dark:bg-[#0E1B3D] dark:text-[#9db5ef]',
  shipped: 'bg-[#1D5BEA] text-white',
  delivered: 'bg-[#eef1f6] text-[#4a5672] dark:bg-slate-800 dark:text-slate-300',
  canceled: 'bg-[#f4f6fa] text-[#8a94a8] dark:bg-slate-900 dark:text-slate-500',
}

const pill = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap'

export function StatusBadge({ status }: { status: string }) {
  return <span className={`${pill} ${STATUS_STYLES[status as OrderStatus] || STATUS_STYLES.cart_submitted}`}>{ORDER_STATUS_LABELS[status as OrderStatus] || status}</span>
}

/** A second badge, only when the payment needs someone's attention. */
export function PaymentFlag({ order }: { order: { status: string; payment_status: string } }) {
  if (needsRefund(order)) return <span className={`${pill} bg-[#fdf0f0] text-[#b91c1c] dark:bg-red-950/60 dark:text-red-300`}>Refund due</span>
  if (order.payment_status === 'refunded') return <span className={`${pill} bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300`}>Refunded</span>
  if (order.payment_status === 'failed' && order.status !== 'canceled') return <span className={`${pill} bg-[#fdf0f0] text-[#b91c1c] dark:bg-red-950/60 dark:text-red-300`}>Payment failed</span>
  return null
}

/** A number tile. The note wraps to two lines (it was cut off on phones); `extra` sits under it, inside the tile. */
export function Metric({ label, value, note, icon: Icon, tone = 'text-[#1D5BEA]', attention = false, extra }: { label: string; value: string; note: string; icon: LucideIcon; tone?: string; attention?: boolean; extra?: React.ReactNode }) {
  return (
    <div className={`${cardClass} p-3.5 sm:p-4 h-full flex flex-col min-w-0`}>
      <div className="flex items-start justify-between gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        <span className="min-w-0 leading-snug">{label}</span>
        <Icon size={16} className={`shrink-0 ${tone}`} />
      </div>
      <div className="mt-1.5 text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums truncate">{value}</div>
      <div className={`mt-0.5 text-[11px] leading-snug line-clamp-3 ${attention ? 'text-[#b91c1c] dark:text-red-300 font-semibold' : 'text-slate-500 dark:text-slate-400'}`} title={note}>{note}</div>
      {extra}
    </div>
  )
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`bg-white dark:bg-[#111b21] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full ${wide ? 'max-w-lg' : 'max-w-md'} max-h-[calc(100dvh-2rem)] overflow-y-auto`}>
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 bg-white dark:bg-[#111b21] border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white">{title}</h3>
          <button type="button" aria-label="Close" onClick={onClose} className={iconButton}>
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

/** "Showing 26–50 of 128 orders" with previous / next. Hidden when everything fits on one page. */
export function Pager({ page, pages, total, pageSize, shown, noun, onPage, disabled }: { page: number; pages: number; total: number; pageSize: number; shown: number; noun: string; onPage: (page: number) => void; disabled?: boolean }) {
  if (total <= pageSize && page === 1) return null
  const first = (page - 1) * pageSize + 1
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-500 dark:text-slate-400">
      <span className="tabular-nums">
        Showing {first.toLocaleString()}–{(first + shown - 1).toLocaleString()} of {total.toLocaleString()} {noun}
      </span>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => onPage(page - 1)} disabled={disabled || page <= 1} className={`${secondaryButton} h-8 px-2.5`} aria-label="Previous page">
          <ChevronLeft size={14} /> Previous
        </button>
        <span className="px-1 tabular-nums font-semibold text-slate-700 dark:text-slate-200">{page} / {pages}</span>
        <button type="button" onClick={() => onPage(page + 1)} disabled={disabled || page >= pages} className={`${secondaryButton} h-8 px-2.5`} aria-label="Next page">
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

/** A value that follows `value` after it has stopped changing for `delay` ms (search boxes). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

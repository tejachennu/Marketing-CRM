'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ORDER_STATUS_LABELS, needsRefund, type OrderStatus } from '@/lib/commerce/commerce-utils'

// ── Shared styles for the store screens ──────────────────────────────────────
export const cardClass = 'bg-white dark:bg-[#111b21] rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-[0_1px_2px_rgba(11,20,26,0.05)]'
export const inputClass =
  'w-full h-9 px-3 text-[13px] rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60'
export const textareaClass = inputClass.replace('h-9 ', '') + ' py-2 resize-y'
export const labelClass = 'block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1'
export const hintClass = 'text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 mt-1'
export const sectionTitle = 'text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5'
export const primaryButton =
  'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-[#008069] hover:bg-[#006d59] text-white text-xs font-bold shadow-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'
export const secondaryButton =
  'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'
export const dangerButton =
  'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'
/** A square, bordered button holding only an icon (refresh, and the like). */
export const squareButton =
  'inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
export const iconButton =
  'inline-flex items-center justify-center h-8 w-8 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'

export type ShowToast = (kind: 'success' | 'error', text: string) => void

const STATUS_STYLES: Record<OrderStatus, string> = {
  cart_submitted: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  awaiting_address: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  payment_pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  cod_confirmed: 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300',
  shipped: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
  delivered: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300',
  canceled: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}

const pill = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap'

export function StatusBadge({ status }: { status: string }) {
  return <span className={`${pill} ${STATUS_STYLES[status as OrderStatus] || STATUS_STYLES.cart_submitted}`}>{ORDER_STATUS_LABELS[status as OrderStatus] || status}</span>
}

/** A second badge, only when the payment needs someone's attention. */
export function PaymentFlag({ order }: { order: { status: string; payment_status: string } }) {
  if (needsRefund(order)) return <span className={`${pill} bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300`}>Refund due</span>
  if (order.payment_status === 'refunded') return <span className={`${pill} bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300`}>Refunded</span>
  if (order.payment_status === 'failed' && order.status !== 'canceled') return <span className={`${pill} bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300`}>Payment failed</span>
  return null
}

export function Metric({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: LucideIcon; tone: string }) {
  return (
    <div className={`${cardClass} p-4`}>
      <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
        <span>{label}</span>
        <Icon size={16} className={tone} />
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums truncate">{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">{note}</div>
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
    <div className="flex items-center justify-between gap-3 pt-1 text-xs text-slate-500 dark:text-slate-400">
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

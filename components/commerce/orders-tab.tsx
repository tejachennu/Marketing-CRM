'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Bell, Check, Copy, Loader2, MapPin, MessageCircle, Package, Phone, RefreshCw, Search, Truck, X } from 'lucide-react'
import type { CommerceOrder } from '@/lib/types'
import { useConfirm } from '@/lib/dialog-context'
import type { CommerceSummary } from '@/lib/commerce/commerce-stats'
import {
  OPEN_CHECKOUT_STATUSES,
  ORDER_STATUS_LABELS,
  TO_SHIP_STATUSES,
  formatAddress,
  formatMoney,
  getFulfillment,
  getNextOrderStatuses,
  hasPaymentRequest,
  needsRefund,
  type OrderStatus,
  type OrderView,
} from '@/lib/commerce/commerce-utils'
import { PaymentFlag, Pager, StatusBadge, cardClass, dangerButton, hintClass, iconButton, inputClass, labelClass, primaryButton, secondaryButton, sectionTitle, squareButton, useDebounced, type ShowToast } from './ui'

const PAGE_SIZE = 25
const REFRESH_MS = 30_000

const VIEWS: Array<{ id: OrderView; label: string; count: (summary: CommerceSummary) => number }> = [
  { id: 'all', label: 'All', count: (summary) => summary.total },
  { id: 'awaiting', label: 'Awaiting customer', count: (summary) => summary.awaiting },
  { id: 'to_ship', label: 'To ship', count: (summary) => summary.toShip },
  { id: 'shipped', label: 'Shipped', count: (summary) => summary.shipped },
  { id: 'delivered', label: 'Delivered', count: (summary) => summary.delivered },
  { id: 'canceled', label: 'Canceled', count: (summary) => summary.canceled },
]

const STEP_SENT: Record<string, string> = {
  address: 'the delivery address form',
  choice: 'the choice between paying online and Cash on Delivery',
  payment: 'a new payment request',
  cod: 'the Cash on Delivery confirmation',
  acknowledged: 'a note that your team will be in touch',
}

function customerName(order: CommerceOrder): string {
  return [order.contact?.first_name, order.contact?.last_name].filter(Boolean).join(' ') || order.shipping_address?.full_name || 'Customer'
}

function itemSummary(order: CommerceOrder): string {
  return order.items?.map((item) => `${item.quantity} × ${item.title}`).join(', ') || '—'
}

function paymentLabel(order: CommerceOrder): { text: string; tone: string } {
  if (needsRefund(order)) return { text: 'Paid, then canceled: refund due', tone: 'text-rose-600 dark:text-rose-400' }
  if (order.payment_status === 'paid') return { text: 'Paid', tone: 'text-emerald-600 dark:text-emerald-400' }
  if (order.payment_status === 'refunded') return { text: 'Refunded', tone: 'text-slate-700 dark:text-slate-200' }
  if (order.payment_status === 'failed') return { text: 'Last payment attempt failed', tone: 'text-rose-600 dark:text-rose-400' }
  if (order.payment_method === 'cod') return { text: 'To be collected on delivery', tone: 'text-slate-900 dark:text-white' }
  return { text: 'Not paid yet', tone: 'text-slate-900 dark:text-white' }
}

const METHOD_LABELS: Record<string, string> = {
  whatsapp_pay: 'Paid in WhatsApp',
  cod: 'Cash on Delivery',
  manual: 'Marked as paid by your team',
  razorpay_link: 'Payment link',
}

interface OrdersTabProps {
  orgId: string
  canEdit: boolean
  /** Whether the store sends an address form, to say what a reminder will contain. */
  collectsAddress: boolean
  onSummary: (summary: CommerceSummary) => void
  summary: CommerceSummary | null
  showToast: ShowToast
}

export function OrdersTab({ orgId, canEdit, collectsAddress, onSummary, summary, showToast }: OrdersTabProps) {
  const confirm = useConfirm()

  const [orders, setOrders] = useState<CommerceOrder[]>([])
  const [view, setView] = useState<OrderView>('all')
  const [search, setSearch] = useState('')
  const appliedSearch = useDebounced(search)
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const [selected, setSelected] = useState<CommerceOrder | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notifyCustomer, setNotifyCustomer] = useState(true)
  const [trackingNumber, setTrackingNumber] = useState('')
  const [carrier, setCarrier] = useState('')
  const [copied, setCopied] = useState(false)

  const requestRef = useRef(0)

  const load = useCallback(async (targetPage: number, options: { silent?: boolean } = {}) => {
    const requestId = ++requestRef.current
    if (!options.silent) setLoading(true)
    try {
      const params = new URLSearchParams({ organizationId: orgId, view, page: String(targetPage), limit: String(PAGE_SIZE) })
      if (appliedSearch.trim()) params.set('search', appliedSearch.trim())
      const res = await fetch(`/api/commerce/orders?${params.toString()}`)
      const data = await res.json().catch(() => ({}))
      // A newer request was sent while this one was on its way: its answer is out of date
      if (requestId !== requestRef.current) return
      if (!res.ok) throw new Error(data.error || 'Orders could not be loaded')

      setOrders(data.orders || [])
      setPagination({ total: data.pagination?.total || 0, pages: data.pagination?.pages || 1 })
      setPage(targetPage)
      if (data.summary) onSummary(data.summary)
      setError('')
      // Keep the open order in step with what the customer has done since
      setSelected((current) => (current ? (data.orders || []).find((order: CommerceOrder) => order.id === current.id) || current : current))

      // The last order of the last page moved to another view: step back
      if ((data.orders || []).length === 0 && (data.pagination?.total || 0) > 0 && targetPage > 1) {
        load(Math.min(targetPage - 1, data.pagination.pages), options)
      }
    } catch (err: any) {
      if (requestId !== requestRef.current) return
      // A failed background refresh keeps what is on screen
      if (!options.silent) setError(err.message || 'Orders could not be loaded')
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [orgId, view, appliedSearch, onSummary])

  // A new view or search starts from the first page
  useEffect(() => {
    load(1)
  }, [load])

  // New carts and payments arrive from WhatsApp at any time: refresh quietly while the page is visible
  const pageRef = useRef(page)
  pageRef.current = page
  const busyRef = useRef(busy)
  busyRef.current = busy
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !busyRef.current) load(pageRef.current, { silent: true })
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  const refresh = async () => {
    setRefreshing(true)
    await load(page, { silent: true })
    setRefreshing(false)
  }

  const openOrder = (order: CommerceOrder) => {
    const fulfillment = getFulfillment(order)
    setSelected(order)
    setNotifyCustomer(true)
    setTrackingNumber(fulfillment.trackingNumber)
    setCarrier(fulfillment.carrier)
    setCopied(false)
  }
  const closeOrder = useCallback(() => setSelected(null), [])

  useEffect(() => {
    if (!selected) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeOrder()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, closeOrder])

  /** Send a change to the server and bring the list and the open order up to date. */
  async function patchOrder(order: CommerceOrder, changes: Record<string, unknown>, action: string) {
    setBusy(action)
    try {
      const res = await fetch('/api/commerce/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, organizationId: orgId, ...changes }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The order could not be updated')
      setSelected((current) => (current && current.id === order.id ? { ...current, ...data.order } : current))
      await load(page, { silent: true })
      return data
    } catch (err: any) {
      showToast('error', err.message)
      // Someone else may have changed it: show its real state
      load(page, { silent: true })
      return null
    } finally {
      setBusy(null)
    }
  }

  async function changeStatus(order: CommerceOrder, status: OrderStatus) {
    const total = formatMoney(order.total_amount, order.currency)
    if (status === 'canceled') {
      const confirmed = await confirm({
        title: `Cancel order #${order.order_number}?`,
        message: order.payment_status === 'paid'
          ? `This order is already paid. Canceling it here does not return the money: refund ${total} through your payment provider afterwards.`
          : hasPaymentRequest(order)
            ? 'The payment request in the customer\'s chat is withdrawn too, so they can no longer pay for it. A canceled order cannot be reopened.'
            : 'A canceled order cannot be reopened.',
        confirmLabel: 'Cancel order',
        cancelLabel: 'Keep order',
        destructive: true,
      })
      if (!confirmed) return
    }
    if (status === 'paid') {
      const confirmed = await confirm({
        title: `Mark #${order.order_number} as paid?`,
        message: `Only do this if you have received ${total} outside WhatsApp (bank transfer, cash, a payment link). Payments made in the chat are recorded automatically.`,
        confirmLabel: 'Yes, it is paid',
      })
      if (!confirmed) return
    }

    const data = await patchOrder(order, {
      status,
      notifyCustomer,
      ...(status === 'shipped' ? { trackingNumber, carrier } : {}),
    }, status)
    if (!data) return

    const label = ORDER_STATUS_LABELS[status]
    const withdrawn = status === 'canceled' && data.paymentRequestCanceled ? ' The payment request in their chat was withdrawn.' : ''
    if (!notifyCustomer) showToast('success', `Order #${order.order_number} is now “${label}”.${withdrawn}`)
    else if (data.notified) showToast('success', `Order #${order.order_number} is now “${label}”. The customer was told on WhatsApp.${withdrawn}`)
    else showToast('error', `Order #${order.order_number} is now “${label}”, but the customer was not told: ${data.notifyError || 'WhatsApp did not accept the message.'}`)
  }

  async function saveTracking(order: CommerceOrder) {
    const data = await patchOrder(order, { trackingNumber, carrier }, 'tracking')
    if (data) showToast('success', 'Tracking details saved.')
  }

  async function markRefunded(order: CommerceOrder) {
    const confirmed = await confirm({
      title: 'Mark as refunded?',
      message: `Confirm that ${formatMoney(order.total_amount, order.currency)} has gone back to the customer through your payment provider. This only records it here; it does not move any money.`,
      confirmLabel: 'Yes, it is refunded',
    })
    if (!confirmed) return
    const data = await patchOrder(order, { paymentStatus: 'refunded' }, 'refund')
    if (data) showToast('success', `Order #${order.order_number} is marked as refunded.`)
  }

  async function sendReminder(order: CommerceOrder) {
    setBusy('remind')
    try {
      const res = await fetch('/api/commerce/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, organizationId: orgId, action: 'remind' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The reminder could not be sent')
      if (data.order) setSelected((current) => (current && current.id === order.id ? { ...current, ...data.order } : current))
      showToast('success', `Reminder sent: the customer got ${STEP_SENT[data.step] || 'the next step'}.`)
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  async function copyAddress(order: CommerceOrder) {
    const address = order.shipping_address
    const text = [address?.full_name, formatAddress(address), address?.phone_number].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      showToast('error', 'The address could not be copied.')
    }
  }

  const filtered = view !== 'all' || Boolean(appliedSearch.trim())
  const nextStatuses = selected ? getNextOrderStatuses(selected.status) : []
  const isOpen = selected ? OPEN_CHECKOUT_STATUSES.includes(selected.status) : false
  const isToShip = selected ? TO_SHIP_STATUSES.includes(selected.status) : false
  const fulfillment = selected ? getFulfillment(selected) : null
  const trackingChanged = Boolean(fulfillment) && (trackingNumber.trim() !== fulfillment!.trackingNumber || carrier.trim() !== fulfillment!.carrier)
  const waitingOn = selected && collectsAddress && !selected.shipping_address?.address_line_1 ? 'their delivery address' : 'payment'

  return (
    <div className="space-y-3">
      <div className={`${cardClass} p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3`}>
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar" role="group" aria-label="Filter orders">
          {VIEWS.map((item) => {
            const active = view === item.id
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => setView(item.id)}
                className={`shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  active ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {item.label}
                {summary && <span className="tabular-nums text-slate-400">{item.count(summary).toLocaleString()}</span>}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative flex-1 lg:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={15} />
            <input type="text" inputMode="search" aria-label="Search orders" placeholder="Order number, name or phone" value={search} onChange={(event) => setSearch(event.target.value)} className={`${inputClass} pl-9 pr-8`} />
            {search && (
              <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <X size={13} />
              </button>
            )}
          </div>
          <button type="button" onClick={refresh} disabled={refreshing} title="Check for new orders" aria-label="Refresh orders" className={squareButton}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className={`${cardClass} py-16 flex items-center justify-center gap-2 text-sm text-slate-500`}>
          <Loader2 size={18} className="animate-spin text-emerald-500" /> Loading orders…
        </div>
      ) : error ? (
        <div role="alert" className={`${cardClass} py-12 px-6 text-center`}>
          <AlertCircle size={26} className="mx-auto text-rose-500" />
          <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Orders could not be loaded</p>
          <p className="mt-1 text-xs text-slate-500 break-words">{error}</p>
          <button type="button" onClick={() => load(page)} className={`${primaryButton} mt-3`}>
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      ) : orders.length === 0 ? (
        <div className={`${cardClass} py-14 px-6 text-center`}>
          <Package size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
          <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{filtered ? 'No orders match this view' : 'No orders yet'}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            {filtered ? 'Try a different filter or search term.' : 'When a customer sends a cart from your WhatsApp catalog, the order appears here automatically.'}
          </p>
          {filtered && (
            <button type="button" onClick={() => { setView('all'); setSearch('') }} className="mt-3 text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer">
              Show all orders
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Table on larger screens */}
          <div className={`${cardClass} hidden md:block overflow-hidden`}>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 border-b border-slate-200/80 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Order</th>
                  <th className="py-2.5 px-4 font-semibold">Customer</th>
                  <th className="py-2.5 px-4 font-semibold">Items</th>
                  <th className="py-2.5 px-4 font-semibold">Status</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Total</th>
                  <th className="py-2.5 px-4 font-semibold">Deliver to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    tabIndex={0}
                    onClick={() => openOrder(order)}
                    onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), openOrder(order))}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800/40 outline-none transition-colors"
                  >
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-bold text-slate-900 dark:text-white">#{order.order_number}</div>
                      <div className="text-[11px] text-slate-400">{new Date(order.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900 dark:text-white truncate max-w-[160px]">{customerName(order)}</div>
                      <div className="text-[11px] text-slate-500">{order.contact?.phone_number}</div>
                    </td>
                    <td className="py-3 px-4 max-w-[220px]">
                      <div className="truncate text-slate-700 dark:text-slate-300">{itemSummary(order)}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge status={order.status} />
                        <PaymentFlag order={order} />
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-white tabular-nums whitespace-nowrap">{formatMoney(order.total_amount, order.currency)}</td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400 max-w-[180px]">
                      {order.shipping_address?.address_line_1 ? (
                        <span className="flex items-center gap-1">
                          <MapPin size={12} className="text-emerald-500 shrink-0" />
                          <span className="truncate">{[order.shipping_address.city, order.shipping_address.pincode].filter(Boolean).join(', ') || order.shipping_address.address_line_1}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">No address yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards on phones */}
          <div className="md:hidden space-y-2">
            {orders.map((order) => (
              <button key={order.id} type="button" onClick={() => openOrder(order)} className={`${cardClass} w-full text-left p-3.5 cursor-pointer`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-slate-900 dark:text-white">#{order.order_number}</div>
                    <div className="text-xs text-slate-500 truncate">{customerName(order)}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <StatusBadge status={order.status} />
                    <PaymentFlag order={order} />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-slate-500 truncate pr-3">{itemSummary(order)}</span>
                  <span className="font-bold text-slate-900 dark:text-white tabular-nums shrink-0">{formatMoney(order.total_amount, order.currency)}</span>
                </div>
              </button>
            ))}
          </div>

          <Pager page={page} pages={pagination.pages} total={pagination.total} pageSize={PAGE_SIZE} shown={orders.length} noun={filtered ? 'matching orders' : 'orders'} onPage={(target) => load(target)} />
        </>
      )}

      {/* ── Order details ── */}
      {selected && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Order ${selected.order_number}`}>
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={closeOrder} />
          <div className="absolute inset-y-0 right-0 w-full max-w-md bg-white dark:bg-[#111b21] border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h3 className="font-bold text-base text-slate-900 dark:text-white mr-1">Order #{selected.order_number}</h3>
                  <StatusBadge status={selected.status} />
                  <PaymentFlag order={selected} />
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{new Date(selected.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
              </div>
              <button type="button" aria-label="Close order" onClick={closeOrder} className={iconButton}>
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {needsRefund(selected) && (
                <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-800 dark:text-rose-200 space-y-2">
                  <p className="flex items-start gap-2">
                    <AlertCircle size={15} className="shrink-0 mt-px" />
                    <span>
                      <strong className="font-semibold">Refund {formatMoney(selected.total_amount, selected.currency)}.</strong> The customer paid for this order and it was canceled. Return the money through your payment provider.
                    </span>
                  </p>
                  {canEdit && (
                    <button type="button" onClick={() => markRefunded(selected)} disabled={busy !== null} className={`${secondaryButton} h-8`}>
                      {busy === 'refund' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} I have refunded it
                    </button>
                  )}
                </div>
              )}

              {/* Customer */}
              <section>
                <h4 className={sectionTitle}>Customer</h4>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-slate-900 dark:text-white truncate">{customerName(selected)}</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      <Phone size={11} /> {selected.contact?.phone_number || 'No phone number'}
                    </p>
                  </div>
                  {selected.conversation_id && (
                    <Link href={`/dashboard?conversationId=${selected.conversation_id}`} className={`${secondaryButton} h-8 px-3`}>
                      <MessageCircle size={13} /> Open chat
                    </Link>
                  )}
                </div>
                {selected.customer_note && <p className="mt-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 text-xs text-slate-600 dark:text-slate-300">Note with the cart: “{selected.customer_note}”</p>}
              </section>

              {/* Items and totals */}
              <section>
                <h4 className={sectionTitle}>Items</h4>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {(selected.items || []).map((item) => (
                    <li key={item.id} className="py-2 flex items-center gap-3">
                      {item.image_url ? (
                        // Catalog images live on arbitrary CDNs, so a plain img is used rather than next/image
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.image_url} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg object-cover bg-slate-100 dark:bg-slate-800" />
                      ) : (
                        <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400"><Package size={16} /></div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900 dark:text-white truncate">{item.title}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {item.quantity} × {formatMoney(item.unit_price, selected.currency)} · SKU {item.retailer_id}
                        </p>
                      </div>
                      <span className="font-semibold text-slate-900 dark:text-white tabular-nums shrink-0">{formatMoney(item.total_price, selected.currency)}</span>
                    </li>
                  ))}
                  {(selected.items || []).length === 0 && <li className="py-2 text-xs text-slate-500">No item details were recorded for this order.</li>}
                </ul>
                <dl className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs space-y-1">
                  <div className="flex justify-between text-slate-600 dark:text-slate-400"><dt>Subtotal</dt><dd className="tabular-nums">{formatMoney(selected.subtotal, selected.currency)}</dd></div>
                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <dt>Shipping{selected.shipping_address?.delivery_speed === 'express' ? ' (express)' : ''}</dt>
                    <dd className="tabular-nums">{Number(selected.shipping_fee) ? formatMoney(selected.shipping_fee, selected.currency) : 'Free'}</dd>
                  </div>
                  {Number(selected.tax_amount) > 0 && (
                    <div className="flex justify-between text-slate-600 dark:text-slate-400"><dt>Tax</dt><dd className="tabular-nums">{formatMoney(selected.tax_amount, selected.currency)}</dd></div>
                  )}
                  <div className="flex justify-between pt-1 text-sm font-bold text-slate-900 dark:text-white"><dt>Total</dt><dd className="tabular-nums">{formatMoney(selected.total_amount, selected.currency)}</dd></div>
                </dl>
              </section>

              {/* Payment */}
              <section>
                <h4 className={sectionTitle}>Payment</h4>
                <p className="text-sm">
                  <span className={`font-semibold ${paymentLabel(selected).tone}`}>{paymentLabel(selected).text}</span>
                  {selected.payment_method && selected.payment_status === 'paid' && <span className="text-slate-500"> · {METHOD_LABELS[selected.payment_method] || selected.payment_method}</span>}
                </p>
                {hasPaymentRequest(selected) && selected.payment_status !== 'paid' && isOpen && (
                  <p className={hintClass}>A payment request is waiting in the customer&apos;s chat (reference {selected.meta_payment_reference}).</p>
                )}
              </section>

              {/* Delivery */}
              <section>
                <div className="flex items-center justify-between">
                  <h4 className={sectionTitle}>Deliver to</h4>
                  {selected.shipping_address?.address_line_1 && (
                    <button type="button" onClick={() => copyAddress(selected)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer mb-1.5">
                      {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy address'}
                    </button>
                  )}
                </div>
                {selected.shipping_address?.address_line_1 ? (
                  <address className="not-italic p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                    <p className="font-semibold text-slate-900 dark:text-white">{selected.shipping_address.full_name}</p>
                    <p>{selected.shipping_address.address_line_1}</p>
                    {selected.shipping_address.address_line_2 && <p>{selected.shipping_address.address_line_2}</p>}
                    <p>{[selected.shipping_address.city, selected.shipping_address.state, selected.shipping_address.pincode].filter(Boolean).join(', ')}</p>
                    {selected.shipping_address.phone_number && <p>{selected.shipping_address.phone_number}</p>}
                    <p className="mt-1 text-slate-500 capitalize">{selected.shipping_address.delivery_speed || 'standard'} delivery</p>
                    {selected.shipping_address.notes && <p className="mt-1 text-slate-500">Note: {selected.shipping_address.notes}</p>}
                  </address>
                ) : (
                  <p className="text-xs text-slate-500">
                    {collectsAddress ? 'The customer has not filled in the address form yet.' : 'This store does not collect addresses in the chat. Ask the customer for it in the chat.'}
                  </p>
                )}
                {fulfillment && (fulfillment.trackingNumber || fulfillment.carrier) && (
                  <p className="mt-2 text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Truck size={13} className="text-blue-500 shrink-0" />
                    <span>
                      {fulfillment.carrier || 'Shipped'}
                      {fulfillment.trackingNumber && <> · <span className="font-mono">{fulfillment.trackingNumber}</span></>}
                      {fulfillment.shippedAt && <span className="text-slate-500"> · {new Date(fulfillment.shippedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>}
                    </span>
                  </p>
                )}
              </section>
            </div>

            {/* Actions: only the moves that make sense from the current status */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-[#0c1317] space-y-3">
              {nextStatuses.length === 0 ? (
                <p className="text-xs text-center text-slate-500">This order is {ORDER_STATUS_LABELS[selected.status].toLowerCase()}. No further steps.</p>
              ) : !canEdit ? (
                <p className="text-xs text-center text-slate-500">Your account is read-only, so you can view this order but not update it.</p>
              ) : (
                <>
                  {isOpen && (
                    <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                      <p className="text-xs text-slate-600 dark:text-slate-300">Waiting on the customer for <strong className="font-semibold text-slate-900 dark:text-white">{waitingOn}</strong>.</p>
                      <button type="button" onClick={() => sendReminder(selected)} disabled={busy !== null} className={`${secondaryButton} h-8 shrink-0`}>
                        {busy === 'remind' ? <Loader2 size={13} className="animate-spin" /> : <Bell size={13} />} Send reminder
                      </button>
                    </div>
                  )}

                  {(isToShip || selected.status === 'shipped') && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="carrier" className={labelClass}>Courier</label>
                        <input id="carrier" type="text" maxLength={60} value={carrier} onChange={(event) => setCarrier(event.target.value)} placeholder="Optional" className={inputClass} />
                      </div>
                      <div>
                        <label htmlFor="tracking" className={labelClass}>Tracking number</label>
                        <input id="tracking" type="text" maxLength={80} value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} placeholder="Optional" className={inputClass} />
                      </div>
                      {selected.status === 'shipped' && trackingChanged && (
                        <button type="button" onClick={() => saveTracking(selected)} disabled={busy !== null} className={`${secondaryButton} col-span-2 h-8`}>
                          {busy === 'tracking' && <Loader2 size={13} className="animate-spin" />} Save tracking details
                        </button>
                      )}
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={notifyCustomer} onChange={(event) => setNotifyCustomer(event.target.checked)} className="h-4 w-4 rounded accent-[#00a884]" />
                    Tell the customer on WhatsApp when the status changes
                  </label>

                  <div className="flex flex-wrap gap-2">
                    {nextStatuses.filter((status) => status !== 'canceled').map((status) => (
                      <button key={status} type="button" disabled={busy !== null} onClick={() => changeStatus(selected, status)} className={`${status === 'cod_confirmed' ? secondaryButton : primaryButton} flex-1`}>
                        {busy === status && <Loader2 size={13} className="animate-spin" />}
                        {status === 'paid' ? 'Mark as paid' : status === 'cod_confirmed' ? 'Confirm as COD' : status === 'shipped' ? 'Mark as shipped' : 'Mark as delivered'}
                      </button>
                    ))}
                    {nextStatuses.includes('canceled') && (
                      <button type="button" disabled={busy !== null} onClick={() => changeStatus(selected, 'canceled')} className={dangerButton}>
                        {busy === 'canceled' && <Loader2 size={13} className="animate-spin" />} Cancel order
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

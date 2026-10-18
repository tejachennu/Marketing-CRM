'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle, AlertTriangle, CheckCircle2, Clock, CreditCard, ExternalLink, Loader2, MapPin,
  MessageCircle, MinusCircle, Package, RefreshCw, Rocket, ShoppingCart, Truck, Wallet, XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { CHECKOUT_TEXT, formatMoney, getPaymentStep } from '@/lib/commerce/commerce-utils'
import { getGoLiveChecks, isReadyToSell, type CheckState, type GoLiveCheck, type MetaDetection } from '@/lib/commerce/go-live-checks'
import { formatContactDisplayName } from '@/lib/whatsapp-bsuid'
import { describeCommerceMessage, parseCommerceMessage } from '@/lib/chat-commerce'
import { StatusBadge, cardClass, secondaryButton, squareButton, type ShowToast } from './ui'

interface RecentOrder {
  id: string
  order_number: string
  status: string
  total_amount: number
  currency: string
  created_at: string
  contact?: { first_name?: string | null; last_name?: string | null; phone_number?: string | null } | null
  trail: Array<{ body: string; status: string | null; error_message: string | null; sender_type: string; created_at: string }>
}

const STATE_ICON: Record<CheckState, { icon: LucideIcon; tone: string }> = {
  ok: { icon: CheckCircle2, tone: 'text-emerald-500' },
  warning: { icon: AlertTriangle, tone: 'text-amber-500' },
  error: { icon: XCircle, tone: 'text-rose-500' },
  skipped: { icon: MinusCircle, tone: 'text-slate-400' },
  unknown: { icon: Loader2, tone: 'text-slate-400 animate-spin' },
}

/** A WhatsApp-style bubble for the preview of what the customer sees. */
function Bubble({ from, text, buttons }: { from: 'customer' | 'store'; text: string; buttons?: string[] }) {
  const store = from === 'store'
  return (
    <div className={`flex ${store ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[92%] sm:max-w-[420px] rounded-lg shadow-[0_1px_0.5px_rgba(11,20,26,.13)] text-[13px] leading-[18px] text-[#111b21] dark:text-[#e9edef] overflow-hidden ${store ? 'bg-white dark:bg-[#202c33] rounded-tl-none' : 'bg-[#d9fdd3] dark:bg-[#005c4b] rounded-tr-none'}`}>
        <p className="px-2.5 py-1.5 whitespace-pre-line">{text}</p>
        {buttons && buttons.length > 0 && (
          <div className="border-t border-black/10 dark:border-white/10 divide-y divide-black/10 dark:divide-white/10">
            {buttons.map((button) => (
              <div key={button} className="py-1.5 text-center text-[13px] font-medium text-[#008069] dark:text-[#00a884]">{button}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FlowStep({ icon: Icon, title, note, off, children, last }: { icon: LucideIcon; title: string; note?: string; off?: boolean; children?: React.ReactNode; last?: boolean }) {
  return (
    <li className="relative pl-12">
      {!last && <span className="absolute left-[19px] top-10 bottom-0 w-px bg-slate-200 dark:bg-slate-700" aria-hidden />}
      <span className={`absolute left-0 top-0 h-10 w-10 rounded-xl flex items-center justify-center ${off ? 'bg-slate-100 text-slate-400 dark:bg-slate-800' : 'bg-[#e7f6ea] text-[#008069] dark:bg-emerald-950/50 dark:text-emerald-400'}`}>
        <Icon size={18} />
      </span>
      <div className="pb-6">
        <p className={`text-sm font-bold ${off ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-900 dark:text-white'}`}>{title}</p>
        {note && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{note}</p>}
        {children && !off && <div className="mt-2.5 rounded-xl bg-[#efeae2] dark:bg-[#0b141a] p-3 space-y-2 wa-chat-wallpaper">{children}</div>}
      </div>
    </li>
  )
}

/** One line of an order's checkout trail, without the bracket notation the chat log uses. */
function trailText(body: string) {
  const commerce = parseCommerceMessage(body)
  if (commerce?.kind === 'order') return `${describeCommerceMessage(commerce).replace(/^🛒 /, '')} received`
  return body.replace(/^\[|\]$/g, '')
}

export function OrderFlowTab({
  orgId,
  orgData,
  onOpenSettings,
  onOpenOrders,
  onSaved,
  showToast,
}: {
  orgId: string
  orgData: Record<string, any>
  onOpenSettings: () => void
  onOpenOrders: () => void
  onSaved: (changes: Record<string, any>) => void
  showToast: ShowToast
}) {
  const [meta, setMeta] = useState<MetaDetection | null>(null)
  const [checking, setChecking] = useState(false)
  const [orders, setOrders] = useState<RecentOrder[] | null>(null)
  const [enabling, setEnabling] = useState(false)

  const load = useCallback(async () => {
    setChecking(true)
    try {
      const [metaRes, ordersRes] = await Promise.all([
        fetch(`/api/commerce/meta-detect?organizationId=${orgId}`),
        fetch(`/api/commerce/order-flow?organizationId=${orgId}`),
      ])
      const metaBody = await metaRes.json().catch(() => ({}))
      // A store without WhatsApp gets a 400 here; the checks then show "connect WhatsApp"
      setMeta(metaRes.ok ? metaBody : { connectionError: metaBody.error || 'Meta could not be reached.' })
      const ordersBody = await ordersRes.json().catch(() => ({}))
      setOrders(ordersRes.ok ? ordersBody.orders || [] : [])
    } catch {
      setMeta({ connectionError: 'Meta could not be reached. Check your connection and try again.' })
      setOrders([])
    } finally {
      setChecking(false)
    }
  }, [orgId])

  useEffect(() => { load() }, [load])

  const checks = useMemo(() => getGoLiveChecks(orgData, meta), [orgData, meta])
  const ready = meta !== null && isReadyToSell(checks)
  const blocking = checks.filter((check) => check.required && check.state === 'error').length

  async function enableCart() {
    setEnabling(true)
    try {
      const res = await fetch('/api/commerce/meta-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, action: 'enable_cart' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Meta did not turn the cart on.')
      setMeta((current) => (current ? { ...current, commerceSettings: { ...(current.commerceSettings || {}), is_cart_enabled: true, is_catalog_visible: true }, commerceSettingsError: null } : current))
      showToast('success', 'Cart and catalog are now on for your WhatsApp number.')
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setEnabling(false)
    }
  }

  async function switchStoreOn() {
    const res = await fetch('/api/organization', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: orgId, updates: { enable_commerce: true } }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return showToast('error', data.error || 'The store could not be switched on.')
    onSaved({ enable_commerce: true })
    showToast('success', 'Store switched on: new carts become orders.')
  }

  function FixButton({ check }: { check: GoLiveCheck }) {
    if (check.state === 'ok' || check.state === 'unknown' || !check.fix) return null
    if (check.fix === 'enable_cart') {
      return (
        <button type="button" onClick={enableCart} disabled={enabling} className={secondaryButton}>
          {enabling ? <Loader2 size={13} className="animate-spin" /> : <ShoppingCart size={13} />} Turn on
        </button>
      )
    }
    if (check.fix === 'settings') return <Link href="/dashboard/settings" className={secondaryButton}>Open Settings</Link>
    if (check.fix === 'whatsapp_manager') {
      return <a href="https://business.facebook.com/wa/manage/" target="_blank" rel="noreferrer" className={secondaryButton}>WhatsApp Manager <ExternalLink size={12} /></a>
    }
    if (check.id === 'store' && orgData.enable_commerce === false) {
      return <button type="button" onClick={switchStoreOn} className={secondaryButton}>Switch on</button>
    }
    return <button type="button" onClick={onOpenSettings} className={secondaryButton}>Store settings</button>
  }

  // ── What the customer sees, with the store's real settings and a sample order ──
  const currency = String(orgData.currency || 'INR').toUpperCase()
  const sampleTotal = formatMoney(499, currency)
  const sampleOrder = 'ORD-XXXXXX-XXXX'
  const received = CHECKOUT_TEXT.received(sampleOrder, 1, sampleTotal)
  const collectsAddress = Boolean(String(orgData.commerce_address_flow_id || '').trim())
  const paymentStep = getPaymentStep(orgData)
  const paymentIntro = collectsAddress ? `Thanks, your delivery address is saved. Order #${sampleOrder} total: ${sampleTotal}.` : received
  const paymentBubble = {
    choice: { text: `${paymentIntro}\n\n${CHECKOUT_TEXT.askHowToPay(sampleTotal)}`, buttons: ['Pay online', 'Cash on Delivery'] },
    payment: { text: `${paymentIntro}\n\n${CHECKOUT_TEXT.payOnline}`, buttons: ['Review and pay'] },
    cod: { text: `${paymentIntro}\n\n${CHECKOUT_TEXT.confirmCod(sampleTotal)}`, buttons: ['Confirm order'] },
    acknowledged: { text: `${paymentIntro}\n\n${CHECKOUT_TEXT.acknowledge}`, buttons: [] },
  }[paymentStep]
  const offersOnline = paymentStep === 'choice' || paymentStep === 'payment'
  const offersCod = paymentStep === 'choice' || paymentStep === 'cod'

  return (
    <div className="space-y-5">
      {/* Go-live status */}
      <section className={`${cardClass} p-4 sm:p-5`}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3">
            <span className={`h-11 w-11 shrink-0 rounded-2xl flex items-center justify-center ${meta === null ? 'bg-slate-100 text-slate-400 dark:bg-slate-800' : ready ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' : 'bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400'}`}>
              {meta === null ? <Loader2 size={20} className="animate-spin" /> : ready ? <Rocket size={20} /> : <AlertCircle size={20} />}
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {meta === null ? 'Checking your store with Meta…' : ready ? 'Ready to take orders on WhatsApp' : `${blocking} thing${blocking === 1 ? '' : 's'} to fix before you go live`}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {ready
                  ? 'Send a test cart from another phone to see the whole flow end to end.'
                  : 'Each check reads your settings and what Meta reports for your WhatsApp account.'}
              </p>
            </div>
          </div>
          <button type="button" onClick={load} disabled={checking} title="Check again" aria-label="Check again" className={squareButton}>
            <RefreshCw size={15} className={checking ? 'animate-spin' : ''} />
          </button>
        </div>

        <ol className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {checks.map((check, index) => {
            const { icon: Icon, tone } = STATE_ICON[check.state]
            return (
              <li key={check.id} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60">
                <Icon size={18} className={`shrink-0 mt-0.5 ${tone}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-900 dark:text-white">
                    <span className="text-slate-400 font-medium mr-1">{index + 1}.</span>
                    {check.title}
                    {!check.required && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Optional</span>}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{check.detail}</p>
                </div>
                <div className="shrink-0"><FixButton check={check} /></div>
              </li>
            )
          })}
        </ol>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 items-start">
        {/* The flow, as the customer and the team experience it */}
        <section className={`${cardClass} p-4 sm:p-5 xl:col-span-3`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">How an order flows</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">With your current settings, for a sample order of {sampleTotal}. These are the exact messages customers get.</p>
          <ol>
            <FlowStep icon={ShoppingCart} title="1. Customer sends a cart" note="They open your catalog in the chat, add products and tap Send cart.">
              <Bubble from="customer" text={`🛒 1 item · ${sampleTotal}`} />
            </FlowStep>
            <FlowStep icon={Package} title="2. The order is created and confirmed" note="An order appears in Orders straight away, and the customer is answered in seconds.">
              {collectsAddress
                ? <Bubble from="store" text={`${received}\n\n${CHECKOUT_TEXT.askAddress}`} buttons={['Add address']} />
                : <Bubble from="store" text={paymentBubble.text} buttons={paymentBubble.buttons} />}
            </FlowStep>
            <FlowStep icon={MapPin} title="3. Delivery address" off={!collectsAddress} note={collectsAddress ? 'Name, phone, address, city, state, PIN and standard or express delivery. Express adds its charge to the total.' : 'Skipped: no address form is set in Store settings.'}>
              <Bubble from="customer" text="📍 Address submitted" />
              <Bubble from="store" text={paymentBubble.text} buttons={paymentBubble.buttons} />
            </FlowStep>
            <FlowStep icon={Wallet} title="4. Payment" note={
              paymentStep === 'choice' ? 'The customer picks online payment or Cash on Delivery.'
                : paymentStep === 'payment' ? 'Online payment only: the customer pays by UPI or card inside WhatsApp.'
                  : paymentStep === 'cod' ? 'Cash on Delivery only: one tap confirms the order.'
                    : 'No way to pay is set up: the customer is only told your team will call.'
            }>
              {offersCod && (
                <>
                  <Bubble from="customer" text={paymentStep === 'choice' ? 'Cash on Delivery' : 'Confirm order'} />
                  <Bubble from="store" text={CHECKOUT_TEXT.codConfirmed(sampleOrder, sampleTotal)} />
                </>
              )}
              {offersCod && offersOnline && <p className="text-center text-[11px] font-semibold text-slate-500 dark:text-slate-400 py-1">or</p>}
              {offersOnline && (
                <>
                  {paymentStep === 'choice' && (
                    <>
                      <Bubble from="customer" text="Pay online" />
                      <Bubble from="store" text={`Order #${sampleOrder}: ${sampleTotal}.\n\n${CHECKOUT_TEXT.payOnline}`} buttons={['Review and pay']} />
                    </>
                  )}
                  <Bubble from="customer" text="💳 Paid by UPI" />
                  <Bubble from="store" text={CHECKOUT_TEXT.paid(sampleTotal, sampleOrder)} />
                </>
              )}
            </FlowStep>
            <FlowStep icon={Truck} title="5. Your team ships it" last note="Orders → To ship → Mark as shipped (with carrier and tracking), then Mark as delivered. The customer is messaged at each step. For Cash on Delivery, Mark as paid once the cash is collected." />
          </ol>
        </section>

        {/* What actually happened to recent orders */}
        <section className={`${cardClass} p-4 sm:p-5 xl:col-span-2`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Recent orders</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">What each customer was sent, so you can see where a checkout stopped.</p>
          {orders === null ? (
            <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : orders.length === 0 ? (
            <div className="text-xs text-slate-500 dark:text-slate-400 rounded-xl bg-slate-50 dark:bg-slate-900/60 p-4 flex items-start gap-2.5">
              <MessageCircle size={16} className="shrink-0 mt-px text-slate-400" />
              <span>No orders yet. From another phone, open your WhatsApp chat, tap the shop icon, add a product and send the cart. It will show here within seconds.</span>
            </div>
          ) : (
            <ul className="space-y-3">
              {orders.map((order) => {
                const replies = order.trail.filter((entry) => entry.sender_type === 'user')
                const delivered = replies.some((entry) => entry.status !== 'failed')
                const failure = replies.find((entry) => entry.status === 'failed')
                return (
                  <li key={order.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-slate-900 dark:text-white truncate">#{order.order_number}</p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {order.contact ? formatContactDisplayName(order.contact as any) : 'Customer'} · {formatMoney(order.total_amount, order.currency)} · {new Date(order.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                      <StatusBadge status={order.status} />
                    </div>
                    <ul className="mt-2.5 space-y-1.5">
                      {order.trail.map((entry, index) => {
                        const failed = entry.status === 'failed'
                        const Icon = entry.sender_type === 'contact' ? ShoppingCart : failed ? XCircle : CheckCircle2
                        return (
                          <li key={index} className="flex items-start gap-2 text-[11.5px] leading-snug">
                            <Icon size={13} className={`shrink-0 mt-px ${entry.sender_type === 'contact' ? 'text-slate-400' : failed ? 'text-rose-500' : 'text-emerald-500'}`} />
                            <span className="min-w-0">
                              <span className={failed ? 'text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300'}>{trailText(entry.body)}</span>
                              {failed && entry.error_message && <span className="block text-rose-600 dark:text-rose-400">{entry.error_message}</span>}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                    {!delivered && (
                      <p className="mt-2 flex items-start gap-1.5 text-[11.5px] font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg p-2">
                        <AlertCircle size={13} className="shrink-0 mt-px" />
                        {failure ? 'No checkout message reached this customer. Fix the reason above, then open the order and use “Send reminder”.' : 'No checkout message was recorded for this order. It came in while the store was set up differently, or before this was tracked.'}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <button type="button" onClick={onOpenOrders} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#008069] dark:text-[#00a884] hover:underline cursor-pointer">
            <Clock size={13} /> All orders
          </button>
        </section>
      </div>

      <p className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <CreditCard size={13} className="shrink-0 mt-px" />
        In-chat online payment works for businesses in India, in rupees, with a payment setup in WhatsApp Manager → Payments (Razorpay, PayU, BillDesk or Zaakpay).
      </p>
    </div>
  )
}

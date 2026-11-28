'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ExternalLink, FileText, Loader2, RefreshCw, Truck, X } from 'lucide-react'
import {
  ATTENTION_SHIPMENT_STATUSES, PROVIDER_NAMES, SHIPMENT_STATUS_LABELS, trackingLink,
  type ShipmentStatus, type ShippingProvider,
} from '@/lib/commerce/shipping-rules'
import { primaryButton, secondaryButton, type ShowToast } from './ui'

interface Shipment {
  id: string
  provider: ShippingProvider
  awb: string | null
  courier_name: string | null
  label_url: string | null
  status: ShipmentStatus
  status_text: string | null
  expected_at: string | null
  charge: number | null
  cod: boolean
  warnings: string[] | null
  events: { at: string; text: string; place: string }[] | null
  created_at: string
}

interface Rate {
  provider: ShippingProvider
  courierId: string
  courierName: string
  price: number
  codCharge: number
  days: number | null
  etd: string | null
  rating: number | null
  cod: boolean
  recommended?: boolean
  cheapest?: boolean
  fastest?: boolean
}

const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'The courier could not be reached. Try again.')
  return data
}

/** In an order: send it with a courier partner, and follow the parcel. */
export function CourierPanel({ orgId, orderId, canEdit, onChanged, showToast }: { orgId: string; orderId: string; canEdit: boolean; onChanged: () => void; showToast: ShowToast }) {
  const [info, setInfo] = useState<{ ready: ShippingProvider[]; blocker: string | null; shipments: Shipment[] } | null>(null)
  const [rates, setRates] = useState<{ rates: Rate[]; notes: string[]; cod: boolean; parcel: { weight_grams: number } } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showScans, setShowScans] = useState(false)

  const load = useCallback(async () => {
    try {
      setInfo(await call(`/api/commerce/shipping/ship?organizationId=${orgId}&orderId=${orderId}`))
      setError('')
    } catch (err: any) {
      setError(err.message)
    }
  }, [orgId, orderId])
  useEffect(() => { setInfo(null); setRates(null); load() }, [load])

  async function act(action: string, extra: Record<string, unknown> = {}, done?: string) {
    setBusy(action + (extra.shipmentId || extra.courierId || ''))
    try {
      const data = await call('/api/commerce/shipping/ship', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, orderId, action, ...extra }) })
      if (action === 'rates') setRates(data)
      else {
        setInfo((current) => (current ? { ...current, shipments: data.shipments } : current))
        setRates(null)
        onChanged()
        if (done) showToast('success', done)
      }
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  if (error) return <p className="text-xs text-[#b91c1c] flex gap-1.5"><AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}</p>
  if (!info) return <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Checking couriers…</p>

  const active = info.shipments.find((s) => s.status !== 'cancelled')
  const title = 'text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5'

  if (active) {
    const link = trackingLink(active.provider, active.awb)
    const attention = ATTENTION_SHIPMENT_STATUSES.includes(active.status)
    const cancellable = ['booked', 'pickup_scheduled'].includes(active.status)
    return (
      <section aria-label="Courier">
        <p className={title}>Courier</p>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <Truck size={14} className="text-[#008069] shrink-0" />
            <b className="text-slate-900 dark:text-white">{active.courier_name || PROVIDER_NAMES[active.provider]}</b>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${attention ? 'bg-[#fdf0f0] text-[#b91c1c]' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'}`}>{SHIPMENT_STATUS_LABELS[active.status] || active.status}</span>
            <span className="text-[11px] text-slate-500">via {PROVIDER_NAMES[active.provider]}</span>
          </div>
          {active.awb && <p className="text-slate-700 dark:text-slate-300">AWB <span className="font-mono">{active.awb}</span>{active.cod && ' · Cash on Delivery'}{active.charge != null && ` · ${money(active.charge)}`}</p>}
          {active.status_text && <p className="text-xs text-slate-500">{active.status_text}</p>}
          {active.expected_at && <p className="text-xs text-slate-500">Expected by {active.expected_at}</p>}
          {(active.warnings || []).map((w) => <p key={w} className="text-xs text-[#b91c1c]">{w}</p>)}
          <div className="flex flex-wrap gap-2 pt-1">
            {active.label_url && <a href={active.label_url} target="_blank" rel="noreferrer" className={`${secondaryButton} h-8`}><FileText size={13} /> Label</a>}
            {!active.label_url && active.provider === 'shiprocket' && canEdit && <button type="button" className={`${secondaryButton} h-8`} disabled={busy !== null} onClick={() => act('label', { shipmentId: active.id }, 'Label ready.')}><FileText size={13} /> Make label</button>}
            {link && <a href={link} target="_blank" rel="noreferrer" className={`${secondaryButton} h-8`}><ExternalLink size={13} /> Track</a>}
            <button type="button" className={`${secondaryButton} h-8`} disabled={busy !== null} onClick={() => act('refresh', { shipmentId: active.id })}>
              {busy === 'refresh' + active.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Check now
            </button>
            {cancellable && canEdit && (
              <button type="button" className={`${secondaryButton} h-8`} disabled={busy !== null} onClick={() => window.confirm('Cancel this courier booking? You can book again after.') && act('cancel', { shipmentId: active.id }, 'Courier booking cancelled.')}>
                <X size={13} /> Cancel booking
              </button>
            )}
          </div>
          {(active.events || []).length > 0 && (
            <div>
              <button type="button" className="text-xs font-semibold text-[#008069] hover:text-[#006d5b]" onClick={() => setShowScans(!showScans)}>{showScans ? 'Hide' : 'Show'} the journey ({active.events!.length})</button>
              {showScans && (
                <ol className="mt-2 space-y-1.5 border-l border-slate-200 dark:border-slate-700 pl-3">
                  {active.events!.map((e, i) => (
                    <li key={i} className="text-xs">
                      <p className="text-slate-800 dark:text-slate-200">{e.text || 'Update'}</p>
                      <p className="text-slate-500">{[e.at, e.place].filter(Boolean).join(' · ')}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </section>
    )
  }

  if (!canEdit) return null
  if (info.blocker) {
    // Nothing to send for shop / pick-up orders or orders still waiting on the customer
    return null
  }
  if (!info.ready.length) {
    return (
      <section aria-label="Courier">
        <p className={title}>Courier</p>
        <p className="text-xs text-slate-500">Connect Shiprocket or Delhivery in Store settings → Delivery partners to book a courier from here.</p>
      </section>
    )
  }

  return (
    <section aria-label="Courier">
      <p className={title}>Courier</p>
      {!rates ? (
        <button type="button" className={primaryButton} disabled={busy !== null} onClick={() => act('rates')}>
          {busy === 'rates' ? <Loader2 size={13} className="animate-spin" /> : <Truck size={13} />} Send with courier
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            Parcel about {Math.round(rates.parcel.weight_grams)} g{rates.cod ? ' · Cash on Delivery' : ' · Prepaid'}. Prices from your own accounts.
          </p>
          {rates.notes.map((n) => <p key={n} className="text-xs text-[#b91c1c]">{n}</p>)}
          <ul className="space-y-2">
            {rates.rates.map((r) => (
              <li key={r.provider + r.courierId} className="rounded-xl border border-slate-200 dark:border-slate-700 p-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="min-w-0 flex-1 basis-40">
                  <p className="text-[13px] font-semibold text-slate-900 dark:text-white truncate">{r.courierName}</p>
                  <p className="text-[11px] text-slate-500">
                    {PROVIDER_NAMES[r.provider]}
                    {r.days !== null && ` · ${r.days} day${r.days === 1 ? '' : 's'}`}
                    {r.etd && ` · by ${r.etd}`}
                    {r.rating !== null && ` · ★ ${r.rating}`}
                  </p>
                  <p className="flex flex-wrap gap-1 mt-1">
                    {r.cheapest && <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-200">Cheapest</span>}
                    {r.fastest && <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-200">Fastest</span>}
                    {r.recommended && <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-200">Shiprocket&apos;s pick</span>}
                    {r.provider === 'delhivery' && <span className="text-[10px] text-slate-500">about this price</span>}
                  </p>
                </div>
                <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">{money(r.price)}</p>
                <button type="button" className={`${primaryButton} h-8`} disabled={busy !== null} onClick={() => act('book', { provider: r.provider, courierId: r.courierId, price: r.price }, `Booked with ${r.courierName}.`)}>
                  {busy === 'book' + r.courierId ? <Loader2 size={13} className="animate-spin" /> : null} Book
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={`${secondaryButton} h-8`} onClick={() => setRates(null)}>Close</button>
        </div>
      )}
    </section>
  )
}

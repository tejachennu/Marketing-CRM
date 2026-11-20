'use client'

/**
 * The business's own online payment accounts: Razorpay (UPI, cards, net banking) and Stripe (cards, Apple Pay,
 * Google Pay). Used by Store settings → Website and Front Desk → Setup → Website and booking; both read the same
 * keys. Keys are checked with the gateway before they are saved, and secrets are never shown again.
 */

import { useEffect, useState } from 'react'
import { Check, ChevronDown, Copy, Loader2 } from 'lucide-react'
import { GATEWAY_NAMES, type Gateway } from '@/lib/payments/gateway'

export interface PaymentsState {
  connected: boolean
  keyId: string | null
  live: boolean
  webhook: boolean
  webhookUrl: string | null
  stripe: { connected: boolean; key: string | null; live: boolean; webhook: boolean; webhookUrl: string | null }
  gateways: Gateway[]
  use: Gateway | null
}

type Toast = (kind: 'success' | 'error', message: string) => void

const box = 'rounded-xl border border-[#e3e8f2] dark:border-slate-700 bg-white dark:bg-slate-900'
const field = 'w-full h-10 px-3 rounded-lg border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-slate-950 text-[14px] text-[#0E1B3D] dark:text-white outline-none focus:border-[#1D5BEA]'
const label = 'block text-[12.5px] font-semibold text-[#4a5672] dark:text-slate-300 mb-1'
const hint = 'text-[12.5px] text-[#6B7894] dark:text-slate-400'
const primary = 'h-10 px-4 rounded-lg bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[13.5px] font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50'
const secondary = 'h-10 px-3.5 rounded-lg border border-[#d5ddeb] dark:border-slate-700 text-[13.5px] font-semibold text-[#0E1B3D] dark:text-white inline-flex items-center gap-1.5 cursor-pointer hover:border-[#1D5BEA] disabled:opacity-50'

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'That did not work. Try again.')
  return data as PaymentsState
}

function CopyLine({ value, toast }: { value: string; toast: Toast }) {
  return (
    <div className="flex gap-2">
      <input readOnly value={value} className="w-full min-w-0 h-10 px-3 rounded-lg border border-[#d5ddeb] dark:border-slate-700 bg-[#f4f6fa] dark:bg-slate-950 font-mono text-[12px] text-[#0E1B3D] dark:text-white outline-none" aria-label="Webhook address" />
      <button type="button" aria-label="Copy" onClick={() => navigator.clipboard?.writeText(value).then(() => toast('success', 'Address copied.'))} className={secondary}><Copy size={14} /></button>
    </div>
  )
}

export function OnlinePayments({ orgId, canManage, showToast, onChange }: { orgId: string; canManage: boolean; showToast: Toast; onChange?: (state: PaymentsState) => void }) {
  const [state, setState] = useState<PaymentsState | null>(null)
  const [open, setOpen] = useState<Gateway | null>(null)
  const [keyId, setKeyId] = useState('')
  const [keySecret, setKeySecret] = useState('')
  const [rzpHook, setRzpHook] = useState('')
  const [stripeKey, setStripeKey] = useState('')
  const [stripeHook, setStripeHook] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const apply = (next: PaymentsState) => { setState(next); onChange?.(next) }
  useEffect(() => {
    call(`/api/commerce/storefront/payments?organizationId=${orgId}`).then((data) => { apply(data); setKeyId(data.keyId || '') }).catch(() => {})
    // Loaded once per workspace (onChange may be a new function on every render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function run(kind: string, step: () => Promise<PaymentsState>, done: string) {
    setBusy(kind)
    setError('')
    try {
      const next = await step()
      apply(next)
      setKeySecret(''); setRzpHook(''); setStripeKey(''); setStripeHook('')
      showToast('success', done)
      return next
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  if (!state) return <div className={`${box} p-4 text-[13px] text-[#6B7894] flex items-center gap-2`}><Loader2 size={14} className="animate-spin" /> Checking online payment…</div>

  const put = (body: Record<string, unknown>) => call('/api/commerce/storefront/payments', { method: 'PUT', body: JSON.stringify({ organizationId: orgId, ...body }) })
  const del = (gateway: Gateway) => call(`/api/commerce/storefront/payments?organizationId=${orgId}&gateway=${gateway}`, { method: 'DELETE' })
  const rzp = { connected: state.connected, live: state.live, account: state.keyId, webhook: state.webhook, webhookUrl: state.webhookUrl }
  const stp = { connected: state.stripe.connected, live: state.stripe.live, account: state.stripe.key, webhook: state.stripe.webhook, webhookUrl: state.stripe.webhookUrl }

  const row = (gateway: Gateway, info: typeof rzp, methods: string, fee: string) => (
    <div className={`${box} p-3.5`}>
      <div className="flex items-center gap-3">
        <span className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-[13px] font-extrabold ${info.connected ? 'bg-[#1D5BEA] text-white' : 'bg-[#eef1f6] text-[#4a5672]'}`}>{GATEWAY_NAMES[gateway].slice(0, 1)}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-[#0E1B3D] dark:text-white">{GATEWAY_NAMES[gateway]} {info.connected && <span className="ml-1 text-[12px] font-semibold text-[#1D5BEA]">Connected</span>}</p>
          <p className={`${hint} truncate`}>{info.connected ? <>{info.account}{!info.live && <span className="text-[#b91c1c] font-semibold"> · test mode, no real money</span>}{!info.webhook && ' · webhook not set'}</> : `${methods} · ${fee}`}</p>
        </div>
        {canManage && (
          <button type="button" onClick={() => setOpen(open === gateway ? null : gateway)} aria-expanded={open === gateway} className={secondary}>
            {info.connected ? 'Change' : 'Connect'} <ChevronDown size={14} className={open === gateway ? 'rotate-180' : ''} />
          </button>
        )}
      </div>

      {open === gateway && canManage && gateway === 'razorpay' && (
        <div className="mt-3 pt-3 border-t border-[#eef1f6] dark:border-slate-800 space-y-3">
          <p className={hint}>In Razorpay, open Account &amp; Settings → API Keys → Generate key. Paste both here.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label htmlFor="rzp-id" className={label}>Key ID</label><input id="rzp-id" value={keyId} onChange={(e) => setKeyId(e.target.value.trim())} placeholder="rzp_live_…" autoComplete="off" className={field} /></div>
            <div><label htmlFor="rzp-secret" className={label}>Key Secret{info.connected ? ' (empty = keep)' : ''}</label><input id="rzp-secret" type="password" value={keySecret} onChange={(e) => setKeySecret(e.target.value.trim())} placeholder={info.connected ? '••••••••' : 'Key Secret'} autoComplete="new-password" className={field} /></div>
          </div>
          <div className="space-y-2">
            <p className={hint}><b>Webhook (recommended)</b>: marks payments even if the customer closes the page. Razorpay → Account &amp; Settings → Webhooks → Add new webhook: paste this address, tick <b>payment.captured</b> and <b>order.paid</b>, choose a secret and type it below.</p>
            {info.webhookUrl && <CopyLine value={info.webhookUrl} toast={showToast} />}
            <input type="password" value={rzpHook} onChange={(e) => setRzpHook(e.target.value)} placeholder={info.webhook ? 'Webhook secret saved (type to change)' : 'Webhook secret'} autoComplete="new-password" aria-label="Razorpay webhook secret" className={field} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(busy) || !keyId || (!keySecret && !info.connected)} className={primary}
              onClick={() => run('razorpay', () => put({ keyId, keySecret, ...(rzpHook ? { webhookSecret: rzpHook } : {}) }), 'Razorpay connected.').then((s) => s && setOpen(null))}>
              {busy === 'razorpay' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {info.connected ? 'Save' : 'Connect Razorpay'}
            </button>
            {info.connected && <button type="button" disabled={Boolean(busy)} className={secondary} onClick={() => run('razorpay-off', () => del('razorpay'), 'Razorpay disconnected.').then(() => { setKeyId(''); setOpen(null) })}>Disconnect</button>}
          </div>
        </div>
      )}

      {open === gateway && canManage && gateway === 'stripe' && (
        <div className="mt-3 pt-3 border-t border-[#eef1f6] dark:border-slate-800 space-y-3">
          <p className={hint}>In Stripe, open Developers → API keys and copy the <b>Secret key</b> (sk_live_…). Use sk_test_… to try it first with no real money.</p>
          <div><label htmlFor="stripe-key" className={label}>Secret key{info.connected ? ' (empty = keep)' : ''}</label><input id="stripe-key" type="password" value={stripeKey} onChange={(e) => setStripeKey(e.target.value.trim())} placeholder={info.connected ? '••••••••' : 'sk_live_…'} autoComplete="new-password" className={field} /></div>
          <div className="space-y-2">
            <p className={hint}><b>Webhook (recommended)</b>: Stripe → Developers → Webhooks → Add endpoint: paste this address, choose <b>checkout.session.completed</b> and <b>checkout.session.async_payment_succeeded</b>, then copy its <b>Signing secret</b> (whsec_…) below.</p>
            {info.webhookUrl && <CopyLine value={info.webhookUrl} toast={showToast} />}
            <input type="password" value={stripeHook} onChange={(e) => setStripeHook(e.target.value.trim())} placeholder={info.webhook ? 'Signing secret saved (type to change)' : 'whsec_…'} autoComplete="new-password" aria-label="Stripe signing secret" className={field} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(busy) || (!stripeKey && !info.connected) || (!stripeKey && !stripeHook)} className={primary}
              onClick={() => run('stripe', () => put({ gateway: 'stripe', ...(stripeKey ? { secretKey: stripeKey } : {}), ...(stripeHook ? { webhookSecret: stripeHook } : {}) }), 'Stripe connected.').then((s) => s && setOpen(null))}>
              {busy === 'stripe' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {info.connected ? 'Save' : 'Connect Stripe'}
            </button>
            {info.connected && <button type="button" disabled={Boolean(busy)} className={secondary} onClick={() => run('stripe-off', () => del('stripe'), 'Stripe disconnected.').then(() => setOpen(null))}>Disconnect</button>}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-2.5">
      {row('razorpay', rzp, 'UPI, cards, net banking', 'about 2% fee')}
      {row('stripe', stp, 'Cards, Apple Pay, Google Pay; good for customers abroad', 'Stripe’s fee')}
      {state.gateways.length > 1 && (
        <div className={`${box} p-3.5`}>
          <p className="text-[13.5px] font-bold text-[#0E1B3D] dark:text-white">Customers pay with</p>
          <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Customers pay with">
            {state.gateways.map((g) => (
              <button key={g} type="button" role="radio" aria-checked={state.use === g} disabled={!canManage || Boolean(busy)}
                onClick={() => state.use !== g && run('use', () => put({ use: g }), `Customers now pay with ${GATEWAY_NAMES[g]}.`)}
                className={`h-10 rounded-lg border text-[13.5px] font-bold cursor-pointer ${state.use === g ? 'border-[#1D5BEA] bg-[#1D5BEA] text-white' : 'border-[#d5ddeb] text-[#0E1B3D] dark:text-white hover:border-[#1D5BEA]'}`}>
                {GATEWAY_NAMES[g]}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className={hint}>The money goes straight to <b>your own</b> account. Both your online store and your bookings use it.</p>
      {error && <p role="alert" className="rounded-lg bg-[#fdf0f0] p-2.5 text-[12.5px] font-semibold text-[#b91c1c]">{error}</p>}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { AlertCircle, ArrowDown, ArrowUp, Check, Copy, Download, ExternalLink, Globe, ImagePlus, Loader2, Plus, RefreshCw, Sparkles, Trash2, Clock } from 'lucide-react'
import { PhoneField } from '@/components/phone-field'
import { MAX_PAGE_TEXT, STORE_PAGES, STORE_PAGE_TITLES, starterPage, type StorePageKey } from '@/lib/commerce/store-pages'
import { cardClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton, textareaClass, type ShowToast } from './ui'

const COLOURS = ['#1D5BEA', '#0E1B3D', '#008069', '#B45309', '#BE185D', '#6D28D9', '#0F766E', '#B91C1C']
const MAX_BANNERS = 8

interface Banner { image: string; title: string; text: string; button: string; category: string; link: string }
interface Category { name: string; image: string; productImage?: string }

/** Upload a picture; returns its web address. */
async function upload(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/media/upload', { method: 'POST', body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !String(data.url || '').startsWith('https://')) throw new Error(data.error || 'The picture could not be uploaded. Try a smaller JPG or PNG.')
  return data.url
}

function PictureButton({ value, onChange, label, wide, showToast }: { value: string; onChange: (url: string) => void; label: string; wide?: boolean; showToast: ShowToast }) {
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-2 min-w-0">
      <button type="button" onClick={() => file.current?.click()} className={`relative shrink-0 ${wide ? 'h-20 w-36' : 'h-16 w-16'} rounded-xl border border-dashed border-[#d5ddeb] bg-[#f4f6fa] overflow-hidden flex items-center justify-center text-[#8a94a8] cursor-pointer`} aria-label={label}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : busy ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={20} />}
      </button>
      <input
        ref={file}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const picked = e.target.files?.[0]
          e.target.value = ''
          if (!picked) return
          setBusy(true)
          try {
            onChange(await upload(picked))
          } catch (err: any) {
            showToast('error', err.message)
          } finally {
            setBusy(false)
          }
        }}
      />
      <div className="min-w-0 text-[12px] text-slate-500">
        <button type="button" onClick={() => file.current?.click()} className="font-semibold text-[#1D5BEA] hover:underline cursor-pointer">{value ? 'Change picture' : 'Upload picture'}</button>
        {value && <button type="button" onClick={() => onChange('')} className="ml-3 font-semibold text-slate-500 hover:text-[#b91c1c] cursor-pointer">Remove</button>}
      </div>
    </div>
  )
}

/** The business's own Razorpay account for the store page: keys are checked with Razorpay, then saved; the secret is never shown again. */
function RazorpayConnect({ orgId, payment, onPayment, showToast }: { orgId: string; payment: string; onPayment: (value: 'later' | 'online' | 'both') => void; showToast: ShowToast }) {
  const [state, setState] = useState<{ connected: boolean; keyId: string | null; live: boolean; webhook: boolean; webhookUrl: string | null } | null>(null)
  const [keyId, setKeyId] = useState('')
  const [keySecret, setKeySecret] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch(`/api/commerce/storefront/payments?organizationId=${orgId}`).then((r) => r.json()).then((data) => { if (!data.error) { setState(data); setKeyId(data.keyId || '') } }).catch(() => {})
  }, [orgId])

  async function connect() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/commerce/storefront/payments', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, keyId, keySecret, ...(webhookSecret ? { webhookSecret } : {}) }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Razorpay could not be connected.')
      setState(data)
      setKeySecret('')
      setWebhookSecret('')
      if (payment === 'later') onPayment('both')
      showToast('success', `Razorpay connected${data.live ? '' : ' in test mode (no real money)'}. Save the website to use it.`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  async function disconnect() {
    setBusy(true)
    try {
      const res = await fetch(`/api/commerce/storefront/payments?organizationId=${orgId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      setState(data)
      setKeyId('')
      onPayment('later')
      showToast('success', 'Razorpay disconnected. Customers pay on delivery or pick up.')
    } finally {
      setBusy(false)
    }
  }

  const connected = Boolean(state?.connected)
  return (
    <section className={`${cardClass} p-4 sm:p-5 space-y-3`}>
      <div>
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">Online payment (Razorpay)</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">Customers pay by UPI, card or net banking on your website. The money goes straight to <b>your own</b> Razorpay account; Razorpay charges its fee (about 2%).</p>
      </div>
      {connected ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60">
          <span className="flex-1 text-[13px]"><b>Connected</b> · {state?.keyId}{!state?.live && <span className="ml-1 text-[#b91c1c] font-semibold">(test mode: no real money)</span>}</span>
          <button type="button" onClick={disconnect} disabled={busy} className={secondaryButton}>Disconnect</button>
        </div>
      ) : (
        <p className={hintClass}>In Razorpay, open Account &amp; Settings → API Keys → Generate key. Paste both here.</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Key ID</label>
          <input value={keyId} onChange={(e) => setKeyId(e.target.value.trim())} placeholder="rzp_live_…" autoComplete="off" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Key Secret{connected ? ' (leave empty to keep)' : ''}</label>
          <input type="password" value={keySecret} onChange={(e) => setKeySecret(e.target.value.trim())} placeholder={connected ? '••••••••' : 'Key Secret'} autoComplete="new-password" className={inputClass} />
        </div>
      </div>
      <details className="text-[13px]">
        <summary className="cursor-pointer font-semibold text-[#1D5BEA]">Webhook (recommended): marks orders paid even if the customer closes the page</summary>
        <div className="mt-2 space-y-2">
          <p className={hintClass}>In Razorpay → Account &amp; Settings → Webhooks → Add new webhook: paste this address, tick <b>payment.captured</b> and <b>order.paid</b>, choose a secret, and type the same secret below.</p>
          {state?.webhookUrl && (
            <div className="flex gap-2">
              <input readOnly value={state.webhookUrl} className={`${inputClass} font-mono text-[12px]`} />
              <button type="button" onClick={() => navigator.clipboard?.writeText(state.webhookUrl!).then(() => showToast('success', 'Webhook address copied.'))} className={secondaryButton}><Copy size={13} /></button>
            </div>
          )}
          <input type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder={state?.webhook ? 'Webhook secret saved (type to change)' : 'Webhook secret'} autoComplete="new-password" className={inputClass} />
        </div>
      </details>
      {error && <p role="alert" className="rounded-lg bg-[#fdf0f0] p-2.5 text-xs font-semibold text-[#b91c1c]">{error}</p>}
      <button type="button" onClick={connect} disabled={busy || !keyId || (!keySecret && !connected)} className={primaryButton}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />} {connected ? 'Save keys' : 'Connect Razorpay'}
      </button>
      <div>
        <span className={labelClass}>Payment options on your website</span>
        <p className={`${hintClass} -mt-0.5 mb-2`}>Customers see only the ones switched on. Keep at least one on.</p>
        {(() => {
          const cod = payment !== 'online'
          const now = connected && payment !== 'later'
          const pick = (nextCod: boolean, nextNow: boolean) => {
            if (!nextCod && !nextNow) return showToast('error', 'Keep at least one way to pay switched on.')
            onPayment(nextCod && nextNow ? 'both' : nextNow ? 'online' : 'later')
          }
          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="flex items-start gap-2.5 p-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-[13px] cursor-pointer">
                <input type="checkbox" checked={cod} onChange={(e) => pick(e.target.checked, now)} className="mt-0.5 h-4 w-4 accent-[#1D5BEA]" />
                <span><span className="block font-bold">Cash on delivery</span><span className="block text-slate-500">Pay when the order arrives, or at pick up</span></span>
              </label>
              <label className={`flex items-start gap-2.5 p-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-[13px] ${connected ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                <input type="checkbox" checked={now} disabled={!connected} onChange={(e) => pick(cod, e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#1D5BEA]" />
                <span><span className="block font-bold">Pay now</span><span className="block text-slate-500">{connected ? 'UPI, card or net banking with Razorpay' : 'Connect Razorpay above first'}</span></span>
              </label>
            </div>
          )
        })()}
      </div>
    </section>
  )
}

interface DomainInfo {
  available: boolean
  ourLink: string | null
  domain: string | null
  state: 'connected' | 'waiting' | 'unavailable' | null
  records: { type: string; name: string; value: string }[]
  note: string
  link: string | null
}

/** Where the store opens: our address, or the business's own domain (like Shopify). */
function StoreAddress({ orgId, canManage, showToast }: { orgId: string; canManage: boolean; showToast: ShowToast }) {
  const [info, setInfo] = useState<DomainInfo | null>(null)
  const [choice, setChoice] = useState<'ours' | 'own'>('ours')
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const apply = (data: DomainInfo) => {
    setInfo(data)
    if (data.domain) {
      setChoice('own')
      setDomain(data.domain)
    }
  }
  useEffect(() => {
    fetch(`/api/commerce/storefront/domain?organizationId=${orgId}`)
      .then((res) => res.json())
      .then((data) => { if (!data.error) apply(data) })
      .catch(() => {})
  }, [orgId])

  async function call(method: 'GET' | 'PUT' | 'DELETE', body?: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      const res = method === 'GET'
        ? await fetch(`/api/commerce/storefront/domain?organizationId=${orgId}`)
        : await fetch('/api/commerce/storefront/domain', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, ...body }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Please try again.')
      setInfo(data)
      return data as DomainInfo
    } catch (err: any) {
      setError(err.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function useOurs() {
    setChoice('ours')
    if (!info?.domain) return
    if (!window.confirm(`Stop using ${info.domain}? Your store goes back to our address.`)) {
      setChoice('own')
      return
    }
    const data = await call('DELETE')
    if (data) {
      setDomain('')
      showToast('success', 'Your store uses our address again.')
    } else setChoice('own')
  }

  async function connect() {
    const data = await call('PUT', { domain })
    if (data) {
      setDomain(data.domain || domain)
      showToast('success', data.state === 'connected' ? 'Connected. Your store opens on your domain.' : 'Added. Now add the record at your domain company.')
    }
  }

  async function check() {
    const data = await call('GET')
    if (data) showToast(data.state === 'connected' ? 'success' : 'error', data.state === 'connected' ? 'Connected. Your store opens on your domain.' : 'Not working yet. Check the record, or wait a little longer.')
  }

  const heading = 'text-sm font-bold text-slate-900 dark:text-white'
  const sub = 'text-xs text-slate-500 dark:text-slate-400'
  const option = (value: 'ours' | 'own', title: string, text: string, onPick: () => void) => (
    <label className={`flex gap-3 p-3 rounded-xl border cursor-pointer ${choice === value ? 'border-[#1D5BEA] bg-[#f4f6fa] dark:bg-slate-900/60' : 'border-[#e3e8f2] dark:border-slate-700'}`}>
      <input type="radio" name="store-address" checked={choice === value} onChange={onPick} disabled={!canManage || busy} className="mt-1 accent-[#1D5BEA]" />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-slate-900 dark:text-white">{title}</span>
        <span className={`block ${sub} break-all`}>{text}</span>
      </span>
    </label>
  )
  const connected = info?.state === 'connected'

  return (
    <section className={`${cardClass} p-4 sm:p-5 space-y-3`}>
      <div>
        <h2 className={heading}>Store address</h2>
        <p className={sub}>Use our free address, or open your store on your own domain, like shop.yourname.com.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {option('ours', 'Our address (free)', (info?.ourLink || '').replace(/^https?:\/\//, '') || 'wamacrm.magnetora.in/s/…', useOurs)}
        {option('own', 'My own domain', 'A domain you bought from GoDaddy, Hostinger or any other company.', () => setChoice('own'))}
      </div>

      {choice === 'own' && (
        <div className="space-y-3">
          {info && !info.available && !info.domain && (
            <p className="text-xs font-semibold text-[#b91c1c]">{NOT_SET_UP_WORDS}</p>
          )}
          {(info?.available || info?.domain) && <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value.trim().toLowerCase())}
              placeholder="shop.yourname.com"
              autoCapitalize="none"
              spellCheck={false}
              disabled={!canManage || busy}
              className={`${inputClass} sm:flex-1`}
            />
            {domain !== info?.domain && <button type="button" onClick={connect} disabled={!canManage || busy || !domain} className={`${primaryButton} shrink-0 justify-center`}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />} {info?.domain ? 'Change' : 'Connect'}
            </button>}
          </div>}
          {error && error !== NOT_SET_UP_WORDS && <p role="alert" className="text-xs font-semibold text-[#b91c1c]">{error}</p>}

          {info?.domain && (
            <div className="rounded-xl border border-[#e3e8f2] dark:border-slate-700 p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-slate-900 dark:text-white break-all">{info.domain}</span>
                <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] font-bold ${connected ? 'bg-[#eef1f6] text-[#1D5BEA]' : 'bg-[#fdf0f0] text-[#b91c1c]'}`}>
                  {connected ? <Check size={12} /> : <Clock size={12} />} {connected ? 'Connected' : 'Waiting for your domain'}
                </span>
              </div>
              <p className={sub}>{info.note}</p>
              {!connected && info.records.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">Add this at your domain company (DNS settings):</p>
                  {info.records.map((r, i) => (
                    <div key={i} className="p-2.5 rounded-lg bg-[#f4f6fa] dark:bg-slate-900/60 text-[12px] space-y-1.5">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span><span className="text-[#6B7894]">Type </span><span className="font-mono font-semibold">{r.type}</span></span>
                        <span className="min-w-0 break-all"><span className="text-[#6B7894]">Name </span><span className="font-mono font-semibold">{r.name}</span></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1"><span className="text-[#6B7894]">Value </span><span className="font-mono font-semibold break-all">{r.value}</span></span>
                        <button type="button" onClick={() => navigator.clipboard?.writeText(r.value).then(() => showToast('success', 'Copied.'))} className={`${secondaryButton} shrink-0`}><Copy size={13} /> Copy</button>
                      </div>
                    </div>
                  ))}
                  <p className={sub}>Remove any other A or CNAME record with the same name first. It can take from a few minutes up to a day to work.</p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {!connected && <button type="button" onClick={check} disabled={busy} className={secondaryButton}><RefreshCw size={13} /> Check again</button>}
                {connected && info.link && <a href={info.link} target="_blank" rel="noreferrer" className={secondaryButton}><ExternalLink size={13} /> Open</a>}
                {connected && info.link && <button type="button" onClick={() => navigator.clipboard?.writeText(info.link!).then(() => showToast('success', 'Link copied.'))} className={secondaryButton}><Copy size={13} /> Copy link</button>}
                {canManage && <button type="button" onClick={useOurs} disabled={busy} className={secondaryButton}><Trash2 size={13} /> Remove domain</button>}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** E-commerce → Website: the business's online store page. */
/** Same words as NOT_SET_UP in lib/commerce/store-domain.ts (that file is server code). */
const NOT_SET_UP_WORDS = 'Custom domains are not set up on WAMA yet. Please ask WAMA support.'

/** The parts of the website settings that Save writes, to tell when something is not saved. */
function snapshot(settings: any, categories: { name: string; image?: string }[]) {
  return JSON.stringify({ settings, categories: (categories || []).map((c) => ({ name: c.name, image: c.image || '' })) })
}

export function StorefrontSettings({ orgId, canManage, showToast }: { orgId: string; canManage: boolean; showToast: ShowToast }) {
  const [settings, setSettings] = useState<any>(null)
  const [link, setLink] = useState<string | null>(null)
  const [storeOn, setStoreOn] = useState(true)
  const [categories, setCategories] = useState<Category[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [qr, setQr] = useState('')
  const [suggested, setSuggested] = useState<any>(null)
  const [prefilled, setPrefilled] = useState(false)
  // What is saved: the page shows "not saved" until these match, and whether the store is really open
  const [savedSnap, setSavedSnap] = useState('')
  const [liveEnabled, setLiveEnabled] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/commerce/storefront?organizationId=${orgId}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The website settings could not be loaded.')
      setSettings(data.settings)
      setSuggested(data.suggested || null)
      setPrefilled(data.prefilled === true)
      setLink(data.link)
      setStoreOn(data.storeOn !== false)
      setCategories(data.categories || [])
      setSavedSnap(snapshot(data.settings, data.categories || []))
      setLiveEnabled(data.prefilled !== true && data.settings?.enabled === true)
    } catch (err: any) {
      setError(err.message)
    }
  }, [orgId])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!link) return
    QRCode.toDataURL(link, { margin: 1, width: 480, color: { dark: '#0E1B3D', light: '#ffffff' } }).then(setQr).catch(() => setQr(''))
  }, [link])

  if (error) return <div role="alert" className={`${cardClass} p-5 text-sm text-[#b91c1c] flex gap-2`}><AlertCircle size={16} /> {error}</div>
  if (!settings) return <div className={`${cardClass} py-16 flex items-center justify-center gap-2 text-sm text-slate-500`}><Loader2 size={18} className="animate-spin" /> Loading…</div>

  const set = (changes: Record<string, any>) => setSettings((current: any) => ({ ...current, ...changes }))
  // Pictures we made follow the store colour; the business's own photos are left alone
  const recolour = (url: string, colour: string) => (url && url.includes('/api/public/store-art?') ? url.replace(/([?&]c=)[0-9A-Fa-f]{6}/, `$1${colour.replace('#', '')}`) : url)
  const setColour = (colour: string) => {
    set({ colour, logo: recolour(settings.logo, colour), banners: (settings.banners || []).map((b: Banner) => ({ ...b, image: recolour(b.image, colour) })) })
    setCategories((list) => list.map((c) => ({ ...c, image: recolour(c.image, colour) })))
  }
  /** Fill every blank part from the business's details (nothing typed is replaced). */
  const fillBlanks = () => {
    if (!suggested) return
    const next = { ...settings }
    for (const key of ['title', 'tagline', 'logo', 'announcement', 'delivery_note', 'whatsapp', 'phone', 'address', 'about']) {
      if (!String(next[key] || '').trim()) next[key] = suggested[key]
    }
    if (next.delivery_fee === null || next.delivery_fee === undefined) next.delivery_fee = suggested.delivery_fee
    if (next.free_delivery_from === null || next.free_delivery_from === undefined) next.free_delivery_from = suggested.free_delivery_from
    if (!(next.banners || []).length) next.banners = suggested.banners
    setSettings(next)
    setCategories((list) => list.map((c) => ({ ...c, image: c.image || suggested.categories?.find((s: Category) => s.name.toLowerCase() === c.name.toLowerCase())?.image || '' })))
    showToast('success', 'Filled from your business details. Check and Save.')
  }
  const banners: Banner[] = settings.banners || []
  const setBanner = (i: number, changes: Partial<Banner>) => set({ banners: banners.map((b, j) => (j === i ? { ...b, ...changes } : b)) })
  const move = <T,>(list: T[], i: number, by: number) => {
    const next = [...list]
    const [item] = next.splice(i, 1)
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, item)
    return next
  }
  const ordered = categories

  async function save(next: any = settings) {
    setSaving(true)
    try {
      const body = { ...next, categories: ordered.map((c) => ({ name: c.name, image: c.image })) }
      const res = await fetch('/api/commerce/storefront', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, settings: body }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The website settings could not be saved.')
      setSettings(data.settings)
      setLink(data.link)
      setCategories(data.categories || ordered)
      setSavedSnap(snapshot(data.settings, data.categories || ordered))
      setLiveEnabled(data.settings.enabled === true)
      setPrefilled(false)
      showToast('success', data.settings.enabled ? 'Saved. Your online store is live.' : 'Saved. Your online store is switched off.')
    } catch (err: any) {
      showToast('error', err.message)
      // The switch saves by itself: if that failed, put it back the way it is saved
      if (next !== settings) setSettings((current: any) => ({ ...current, enabled: liveEnabled }))
    } finally {
      setSaving(false)
    }
  }
  /** The on/off switch saves straight away, so "on" always means the store is open. */
  const toggleStore = (enabled: boolean) => {
    const next = { ...settings, enabled }
    setSettings(next)
    save(next)
  }
  const unsaved = canManage && (prefilled || snapshot(settings, categories) !== savedSnap)

  const disabled = !canManage
  const heading = 'text-sm font-bold text-slate-900 dark:text-white'
  const sub = 'text-xs text-slate-500 dark:text-slate-400'

  return (
    <div className="max-w-3xl space-y-4">
      <section className={`${cardClass} p-4 sm:p-5`}>
        <label className="flex items-center justify-between gap-4 cursor-pointer">
          <span>
            <span className={`block ${heading}`}>Online store website</span>
            <span className={`block ${sub}`}>A shop page with your banners, categories and products. Customers add to a cart and order for pick up or delivery; orders come to Orders as “Website”.</span>
          </span>
          <span className="relative shrink-0">
            <input type="checkbox" role="switch" checked={settings.enabled} disabled={disabled || saving} onChange={(e) => toggleStore(e.target.checked)} className="peer sr-only" />
            <span className="block h-6 w-11 rounded-full bg-slate-300 peer-checked:bg-[#1D5BEA] transition-colors" />
            <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
          </span>
        </label>
        {canManage && !liveEnabled && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Your store is closed. Customers who open the link see “This store is not open right now” until you switch it on.</p>}
        {!storeOn && <p className="mt-3 text-xs font-semibold text-[#b91c1c]">Your store is switched off in Store settings, so the website shows nothing until you switch it on.</p>}
        {link && (
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr && <img src={qr} alt="QR code for your store" className="h-20 w-20 rounded-lg border border-[#eef1f6]" />}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-slate-900 dark:text-white break-all">{link.replace(/^https?:\/\//, '')}</p>
              <p className={sub}>Share it on Instagram and WhatsApp, or print the QR code for your counter.</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={() => navigator.clipboard?.writeText(link).then(() => showToast('success', 'Link copied.'))} className={secondaryButton}><Copy size={13} /> Copy</button>
              <a href={link} target="_blank" rel="noreferrer" className={secondaryButton}><ExternalLink size={13} /> Open</a>
              {qr && <a href={qr} download="store-qr.png" className={secondaryButton} aria-label="Download QR code"><Download size={13} /></a>}
            </div>
          </div>
        )}
      </section>

      <StoreAddress orgId={orgId} canManage={canManage} showToast={showToast} />

      {canManage && suggested && (
        <section className={`${cardClass} p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3`}>
          <Sparkles size={18} className="text-[#1D5BEA] shrink-0" />
          <div className="min-w-0 flex-1">
            <p className={heading}>{prefilled ? 'Filled in from your business details' : 'Fill from your business details'}</p>
            <p className={sub}>
              {prefilled
                ? 'Name, logo, contact, delivery charges, categories and banners come from your workspace and products. Pictures are made for you where you have no photo. Check them and press Save.'
                : 'Fills any blank part from your workspace and products: contact, delivery charges, category pictures and banners. What you typed stays.'}
            </p>
          </div>
          {!prefilled && <button type="button" onClick={fillBlanks} className={`${secondaryButton} shrink-0`}><Sparkles size={13} /> Fill blanks</button>}
        </section>
      )}

      <section className={`${cardClass} p-4 sm:p-5 space-y-4`}>
        <h2 className={heading}>Look</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Store name</label>
            <input value={settings.title} onChange={(e) => set({ title: e.target.value })} maxLength={80} placeholder="Your business name" disabled={disabled} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Line under the name</label>
            <input value={settings.tagline} onChange={(e) => set({ tagline: e.target.value })} maxLength={160} placeholder="Handloom sarees from Pochampally" disabled={disabled} className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Strip at the top (optional)</label>
          <input value={settings.announcement} onChange={(e) => set({ announcement: e.target.value })} maxLength={140} placeholder="Free delivery in Hyderabad on orders above ₹999" disabled={disabled} className={inputClass} />
        </div>
        <div>
          <span className={labelClass}>Logo</span>
          <PictureButton value={settings.logo} onChange={(logo) => set({ logo })} label="Upload logo" showToast={showToast} />
        </div>
        <div>
          <span className={labelClass}>Colour</span>
          <div className="flex flex-wrap gap-2">
            {COLOURS.map((c) => (
              <button key={c} type="button" disabled={disabled} onClick={() => setColour(c)} aria-label={`Colour ${c}`} style={{ background: c }} className="h-9 w-9 rounded-full flex items-center justify-center text-white cursor-pointer ring-offset-2 data-[on=true]:ring-2 ring-slate-400" data-on={settings.colour === c}>
                {settings.colour === c && <Check size={16} />}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className={`${cardClass} p-4 sm:p-5 space-y-3`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className={heading}>Banners (slide at the top)</h2>
            <p className={sub}>Wide photos work best (about 1600 × 600). A tap can open a category or a web page.</p>
          </div>
          {banners.length < MAX_BANNERS && !disabled && (
            <button type="button" onClick={() => set({ banners: [...banners, { image: '', title: '', text: '', button: '', category: '', link: '' }] })} className={`${secondaryButton} shrink-0`}><Plus size={13} /> Add banner</button>
          )}
        </div>
        {banners.length === 0 && <p className={hintClass}>No banners: the page starts with your store name on your colour.</p>}
        {banners.map((b, i) => (
          <div key={i} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <PictureButton wide value={b.image} onChange={(image) => setBanner(i, { image })} label={`Banner ${i + 1} picture`} showToast={showToast} />
              <div className="flex gap-1 shrink-0">
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => set({ banners: move(banners, i, -1) })} className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-40 cursor-pointer"><ArrowUp size={14} /></button>
                <button type="button" aria-label="Move down" disabled={i === banners.length - 1} onClick={() => set({ banners: move(banners, i, 1) })} className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-40 cursor-pointer"><ArrowDown size={14} /></button>
                <button type="button" aria-label="Remove banner" onClick={() => set({ banners: banners.filter((_, j) => j !== i) })} className="h-8 w-8 rounded-lg border border-slate-200 text-[#b91c1c] flex items-center justify-center cursor-pointer"><Trash2 size={14} /></button>
              </div>
            </div>
            {!b.image && <p className="text-[12px] font-semibold text-[#b91c1c]">Add a picture, or this banner is left out.</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={b.title} onChange={(e) => setBanner(i, { title: e.target.value })} maxLength={60} placeholder="Big words (optional)" aria-label="Banner title" className={inputClass} />
              <input value={b.text} onChange={(e) => setBanner(i, { text: e.target.value })} maxLength={140} placeholder="Small words (optional)" aria-label="Banner text" className={inputClass} />
              <input value={b.button} onChange={(e) => setBanner(i, { button: e.target.value })} maxLength={24} placeholder="Button, e.g. Shop now (optional)" aria-label="Banner button" className={inputClass} />
              <select value={b.category ? `c:${b.category}` : b.link ? 'link' : ''} onChange={(e) => setBanner(i, e.target.value.startsWith('c:') ? { category: e.target.value.slice(2), link: '' } : e.target.value === 'link' ? { category: '', link: b.link || 'https://' } : { category: '', link: '' })} aria-label="What a tap opens" className={inputClass}>
                <option value="">A tap does nothing</option>
                {categories.map((c) => <option key={c.name} value={`c:${c.name}`}>Opens {c.name}</option>)}
                <option value="link">Opens a web page</option>
              </select>
              {b.link !== '' && (
                <input value={b.link} onChange={(e) => setBanner(i, { link: e.target.value })} placeholder="https://…" aria-label="Web page" className={`${inputClass} sm:col-span-2`} />
              )}
            </div>
          </div>
        ))}
      </section>

      <section className={`${cardClass} p-4 sm:p-5 space-y-3`}>
        <h2 className={heading}>Categories</h2>
        <p className={sub}>From your products (Products tab). Set the order and a picture for each; without one, a product photo is used.</p>
        {categories.length === 0 && <p className={hintClass}>Add products with a category first.</p>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {ordered.map((c, i) => (
            <li key={c.name} className="py-2.5 flex items-center gap-3">
              <PictureButton value={c.image} onChange={(image) => setCategories(categories.map((x) => (x.name === c.name ? { ...x, image } : x)))} label={`${c.name} picture`} showToast={showToast} />
              <span className="flex-1 min-w-0 truncate text-[14px] font-semibold">{c.name}</span>
              <div className="flex gap-1 shrink-0">
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => setCategories(move(categories, i, -1))} className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-40 cursor-pointer"><ArrowUp size={14} /></button>
                <button type="button" aria-label="Move down" disabled={i === categories.length - 1} onClick={() => setCategories(move(categories, i, 1))} className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-40 cursor-pointer"><ArrowDown size={14} /></button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${cardClass} p-4 sm:p-5 space-y-3`}>
        <h2 className={heading}>Ordering</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 text-[13px] font-semibold cursor-pointer">
            <input type="checkbox" checked={settings.pickup} disabled={disabled} onChange={(e) => set({ pickup: e.target.checked || !settings.delivery })} className="h-4 w-4 accent-[#1D5BEA]" /> Customers can pick up
          </label>
          <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 text-[13px] font-semibold cursor-pointer">
            <input type="checkbox" checked={settings.delivery} disabled={disabled} onChange={(e) => set({ delivery: e.target.checked || !settings.pickup })} className="h-4 w-4 accent-[#1D5BEA]" /> You deliver
          </label>
        </div>
        {settings.delivery && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Delivery charge</label>
              <input type="number" min={0} value={settings.delivery_fee ?? ''} onChange={(e) => set({ delivery_fee: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Same as Store settings" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Free delivery from</label>
              <input type="number" min={0} value={settings.free_delivery_from ?? ''} onChange={(e) => set({ free_delivery_from: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Same as Store settings" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Delivery note (areas, times)</label>
              <textarea rows={2} value={settings.delivery_note} onChange={(e) => set({ delivery_note: e.target.value })} maxLength={400} placeholder="We deliver in Hyderabad within 2 days." className={textareaClass} />
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Smallest order (optional)</label>
            <input type="number" min={0} value={settings.min_order || ''} onChange={(e) => set({ min_order: Number(e.target.value) || 0 })} placeholder="No minimum" className={inputClass} />
          </div>
          <label className="flex items-center gap-2 text-[13px] font-semibold cursor-pointer sm:mt-6">
            <input type="checkbox" checked={settings.show_out_of_stock} onChange={(e) => set({ show_out_of_stock: e.target.checked })} className="h-4 w-4 accent-[#1D5BEA]" /> Show out-of-stock products (greyed out)
          </label>
        </div>
        <label className="flex items-start gap-2 text-[13px] font-semibold cursor-pointer">
          <input type="checkbox" checked={settings.accounts !== false} onChange={(e) => set({ accounts: e.target.checked })} className="h-4 w-4 mt-0.5 accent-[#1D5BEA]" />
          <span>Customers can sign in with Google<span className={`block font-normal ${hintClass}`}>They see their orders and where each one is, keep their cart on any phone, and check out faster. Anyone can still order without signing in, and track an order with its number.</span></span>
        </label>
        <p className={hintClass}>Your team confirms each order from Orders. For payment online, connect Razorpay below.</p>
      </section>

      {canManage && <RazorpayConnect orgId={orgId} payment={settings.payment || 'later'} onPayment={(payment) => set({ payment })} showToast={showToast} />}

      <PagesEditor settings={settings} set={set} disabled={disabled} heading={heading} sub={sub} />

      <section className={`${cardClass} p-4 sm:p-5 space-y-3`}>
        <h2 className={heading}>Contact and about</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>WhatsApp number (for “Chat on WhatsApp”)</label>
            <PhoneField value={settings.whatsapp} onChange={(whatsapp) => set({ whatsapp })} inputClassName={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Phone to call</label>
            <PhoneField value={settings.phone} onChange={(phone) => set({ phone })} inputClassName={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Shop address (also the pick-up place)</label>
          <textarea rows={2} value={settings.address} onChange={(e) => set({ address: e.target.value })} maxLength={300} className={textareaClass} />
        </div>
        <div>
          <label className={labelClass}>About your shop</label>
          <textarea rows={3} value={settings.about} onChange={(e) => set({ about: e.target.value })} maxLength={1200} className={textareaClass} />
        </div>
      </section>

      {canManage && (
        <div className={unsaved
          ? 'sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-[#d5ddeb] bg-white dark:bg-slate-900 p-3 shadow-[0_-4px_16px_rgba(14,27,61,0.08)]'
          : 'flex flex-wrap justify-end gap-2'}>
          {unsaved && <p className="mr-auto text-[13px] font-semibold text-[#0E1B3D] dark:text-white">Changes not saved yet</p>}
          {link && liveEnabled && !unsaved && <a href={link} target="_blank" rel="noreferrer" className={secondaryButton}><ExternalLink size={13} /> See the website</a>}
          <button type="button" onClick={() => save()} disabled={saving} className={primaryButton}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />} Save website
          </button>
        </div>
      )}
    </div>
  )
}

/** Info and policy pages: About, Shipping, Returns, Terms, Privacy, Contact (linked at the bottom of the store). */
function PagesEditor({ settings, set, disabled, heading, sub }: { settings: any; set: (changes: Record<string, any>) => void; disabled: boolean; heading: string; sub: string }) {
  const [key, setKey] = useState<StorePageKey>('returns')
  const pages = settings.pages || {}
  const facts = {
    name: settings.title || 'our shop', phone: settings.phone, whatsapp: settings.whatsapp, address: settings.address,
    pickup: settings.pickup, delivery: settings.delivery, deliveryFee: settings.delivery_fee, freeFrom: settings.free_delivery_from, payOnline: settings.payment !== 'later',
  }
  const value = pages[key] || ''
  const setText = (text: string) => set({ pages: { ...pages, [key]: text } })
  return (
    <section className={`${cardClass} p-4 sm:p-5 space-y-3`}>
      <div>
        <h2 className={heading}>Pages: shipping, returns, terms…</h2>
        <p className={sub}>Linked at the bottom of your store. Razorpay and Google look for them, and customers read them before paying.</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Pages">
        {STORE_PAGES.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === key} onClick={() => setKey(k)}
            className={`h-8 px-3 rounded-full border text-xs font-semibold cursor-pointer ${k === key ? 'border-[#1D5BEA] bg-[#1D5BEA]/5 text-[#1D5BEA]' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
            {STORE_PAGE_TITLES[k]}{pages[k] ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <textarea aria-label={STORE_PAGE_TITLES[key]} rows={8} maxLength={MAX_PAGE_TEXT} value={value} disabled={disabled} onChange={(e) => setText(e.target.value)}
        placeholder={key === 'about' ? 'Leave empty to use "About your shop" below.' : key === 'contact' ? 'Leave empty to show your phone, WhatsApp and address.' : 'Write it in your own words, or start with a sample.'}
        className={textareaClass} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={disabled} className={secondaryButton} onClick={() => (!value || window.confirm('Replace what you wrote with the sample?')) && setText(starterPage(key, facts))}>
          <Sparkles size={13} /> Start with a sample
        </button>
        <span className="text-[11px] text-slate-500">The sample uses your delivery charges and contact. Read it and change what is not right for your shop. Press Save website to publish.</span>
      </div>
    </section>
  )
}

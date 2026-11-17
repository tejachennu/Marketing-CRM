'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, Copy, KeyRound, Loader2, Package, RefreshCw, Truck, Unplug } from 'lucide-react'
import { cardClass, dangerButton, hintClass, inputClass, labelClass, primaryButton, secondaryButton, type ShowToast } from './ui'

interface View {
  shiprocket: { connected: boolean; email?: string; pickupLocation?: string; pickupPin?: string }
  delhivery: { connected: boolean; warehouse?: string; pickupPin?: string; live?: boolean; sellerName?: string; sellerAddress?: string; gstin?: string }
  parcel: { weight_grams: number; length_cm: number; breadth_cm: number; height_cm: number }
  notify: boolean
  ready: string[]
  webhookUrl: string
  webhookKey: string | null
}

type Location = { name: string; pin: string; city: string; primary: boolean }

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.')
  return data
}

function CopyLine({ label, value, onCopied }: { label: string; value: string; onCopied: () => void }) {
  return (
    <div>
      <p className={labelClass}>{label}</p>
      <div className="flex gap-2 min-w-0">
        <code className="flex-1 min-w-0 truncate rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 h-9 leading-9 text-[12px] text-slate-700 dark:text-slate-200">{value}</code>
        <button type="button" onClick={() => navigator.clipboard?.writeText(value).then(onCopied)} className={secondaryButton} aria-label={`Copy ${label}`}><Copy size={13} /></button>
      </div>
    </div>
  )
}

/** E-commerce → Store settings → Delivery partners: connect the business's own Shiprocket and / or Delhivery. */
export function DeliveryPartners({ orgId, canManage, showToast }: { orgId: string; canManage: boolean; showToast: ShowToast }) {
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [sr, setSr] = useState({ email: '', password: '', pickupLocation: '' })
  const [dl, setDl] = useState({ token: '', warehouse: '', pickupPin: '', live: true, sellerName: '', sellerAddress: '', gstin: '' })
  const [parcel, setParcel] = useState({ weight_grams: 500, length_cm: 20, breadth_cm: 15, height_cm: 10 })
  const [notify, setNotify] = useState(true)
  const [editing, setEditing] = useState<{ shiprocket: boolean; delhivery: boolean }>({ shiprocket: false, delhivery: false })

  const apply = useCallback((v: View) => {
    setView(v)
    setSr((s) => ({ ...s, email: v.shiprocket.email || s.email, password: '', pickupLocation: v.shiprocket.pickupLocation || '' }))
    setDl((d) => ({
      ...d, token: '', warehouse: v.delhivery.warehouse || d.warehouse, pickupPin: v.delhivery.pickupPin || d.pickupPin, live: v.delhivery.live ?? d.live,
      sellerName: v.delhivery.sellerName || d.sellerName, sellerAddress: v.delhivery.sellerAddress || d.sellerAddress, gstin: v.delhivery.gstin || d.gstin,
    }))
    setParcel(v.parcel)
    setNotify(v.notify)
  }, [])

  useEffect(() => {
    call(`/api/commerce/shipping?organizationId=${orgId}`).then(apply).catch((err) => setError(err.message))
  }, [orgId, apply])

  async function save(provider: string, payload: Record<string, unknown>, done: string) {
    setBusy(provider)
    try {
      const data = await call('/api/commerce/shipping', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, provider, ...payload }) })
      apply(data)
      if (data.locations) setLocations(data.locations)
      if (provider === 'shiprocket' || provider === 'delhivery') setEditing((e) => ({ ...e, [provider]: false }))
      showToast('success', done)
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(provider: 'shiprocket' | 'delhivery') {
    if (!window.confirm(`Disconnect ${provider === 'shiprocket' ? 'Shiprocket' : 'Delhivery'}? Parcels already booked keep going; you just cannot book new ones from WAMA.`)) return
    setBusy(provider)
    try {
      apply(await call(`/api/commerce/shipping?organizationId=${orgId}&provider=${provider}`, { method: 'DELETE' }))
      showToast('success', 'Disconnected.')
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setBusy(null)
    }
  }

  if (error) return <div role="alert" className={`${cardClass} p-5 text-sm text-[#b91c1c] flex gap-2`}><AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}</div>
  if (!view) return <div className={`${cardClass} py-12 flex items-center justify-center gap-2 text-sm text-slate-500`}><Loader2 size={18} className="animate-spin" /> Loading delivery partners…</div>

  const heading = 'text-sm font-bold text-slate-900 dark:text-white'
  const disabled = !canManage || Boolean(busy)
  const showSr = !view.shiprocket.connected || editing.shiprocket
  const showDl = !view.delhivery.connected || editing.delhivery
  const connectedChip = <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200"><Check size={11} /> Connected</span>

  return (
    <section className={`${cardClass} p-4 sm:p-5 space-y-4`} aria-labelledby="delivery-partners-title">
      <div className="flex items-start gap-3">
        <Truck size={20} className="text-[#1D5BEA] shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h2 id="delivery-partners-title" className={heading}>Delivery partners</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Connect your own Shiprocket or Delhivery account. Then send any order from the Orders tab: see prices side by side, book, print the label and ask for pickup. Your customer gets WhatsApp updates as the parcel moves.
          </p>
        </div>
      </div>
      {!canManage && <p className="text-xs text-slate-500">Only an admin can change these.</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Shiprocket */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 space-y-3 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className={heading}>Shiprocket</p>
            {view.shiprocket.connected && connectedChip}
          </div>
          {view.shiprocket.connected && !editing.shiprocket && (
            <div className="space-y-2 text-[13px] text-slate-700 dark:text-slate-200">
              <p className="break-all">API user: <b>{view.shiprocket.email}</b></p>
              <p>Pickup from: <b>{view.shiprocket.pickupLocation}</b> ({view.shiprocket.pickupPin || 'no PIN'})</p>
              {locations.length > 1 && (
                <div>
                  <label className={labelClass} htmlFor="sr-pickup">Pickup address</label>
                  <select id="sr-pickup" className={inputClass} value={sr.pickupLocation} disabled={disabled} onChange={(e) => { setSr({ ...sr, pickupLocation: e.target.value }); save('shiprocket', { email: view.shiprocket.email, pickupLocation: e.target.value }, 'Pickup address saved.') }}>
                    {locations.map((l) => <option key={l.name} value={l.name}>{l.name} · {l.city} {l.pin}</option>)}
                  </select>
                </div>
              )}
              {canManage && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" className={secondaryButton} disabled={disabled} onClick={() => save('shiprocket', { email: view.shiprocket.email }, 'Shiprocket checked. Pick the pickup address if you have more than one.')}>
                    {busy === 'shiprocket' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Pickup addresses
                  </button>
                  <button type="button" className={secondaryButton} disabled={disabled} onClick={() => setEditing({ ...editing, shiprocket: true })}>Change login</button>
                  <button type="button" className={dangerButton} disabled={disabled} onClick={() => disconnect('shiprocket')}><Unplug size={13} /> Disconnect</button>
                </div>
              )}
            </div>
          )}
          {showSr && (
            <form className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); save('shiprocket', { email: sr.email, password: sr.password }, 'Shiprocket connected.') }}>
              <div>
                <label className={labelClass} htmlFor="sr-email">API user email</label>
                <input id="sr-email" type="email" autoComplete="off" className={inputClass} value={sr.email} disabled={disabled} onChange={(e) => setSr({ ...sr, email: e.target.value })} placeholder="api@yourshop.com" />
              </div>
              <div>
                <label className={labelClass} htmlFor="sr-password">API user password</label>
                <input id="sr-password" type="password" autoComplete="new-password" className={inputClass} value={sr.password} disabled={disabled} onChange={(e) => setSr({ ...sr, password: e.target.value })} placeholder={view.shiprocket.connected ? 'Leave blank to keep the saved one' : ''} />
                <p className={hintClass}>In Shiprocket: Settings → API → Configure → Create an API user. Use a different email from your Shiprocket login. Add a pickup address in Shiprocket first.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={primaryButton} disabled={disabled || !sr.email}>{busy === 'shiprocket' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {view.shiprocket.connected ? 'Save' : 'Connect Shiprocket'}</button>
                {editing.shiprocket && <button type="button" className={secondaryButton} onClick={() => setEditing({ ...editing, shiprocket: false })}>Cancel</button>}
              </div>
            </form>
          )}
        </div>

        {/* Delhivery */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 space-y-3 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className={heading}>Delhivery</p>
            {view.delhivery.connected && connectedChip}
            {view.delhivery.connected && view.delhivery.live === false && <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Test account</span>}
          </div>
          {view.delhivery.connected && !editing.delhivery && (
            <div className="space-y-2 text-[13px] text-slate-700 dark:text-slate-200">
              <p>Warehouse: <b>{view.delhivery.warehouse}</b> ({view.delhivery.pickupPin})</p>
              {canManage && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" className={secondaryButton} disabled={disabled} onClick={() => setEditing({ ...editing, delhivery: true })}>Change</button>
                  <button type="button" className={dangerButton} disabled={disabled} onClick={() => disconnect('delhivery')}><Unplug size={13} /> Disconnect</button>
                </div>
              )}
            </div>
          )}
          {showDl && (
            <form className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); save('delhivery', dl, 'Delhivery connected.') }}>
              <div>
                <label className={labelClass} htmlFor="dl-token">API token</label>
                <input id="dl-token" type="password" autoComplete="new-password" className={inputClass} value={dl.token} disabled={disabled} onChange={(e) => setDl({ ...dl, token: e.target.value })} placeholder={view.delhivery.connected ? 'Leave blank to keep the saved one' : ''} />
                <p className={hintClass}>Delhivery&apos;s onboarding team gives you this token (it is different for a test account and a live one).</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-2.5">
                <div className="min-w-0">
                  <label className={labelClass} htmlFor="dl-wh">Warehouse name</label>
                  <input id="dl-wh" className={inputClass} value={dl.warehouse} disabled={disabled} onChange={(e) => setDl({ ...dl, warehouse: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="dl-pin">Its PIN code</label>
                  <input id="dl-pin" inputMode="numeric" maxLength={6} className={inputClass} value={dl.pickupPin} disabled={disabled} onChange={(e) => setDl({ ...dl, pickupPin: e.target.value.replace(/\D/g, '') })} />
                </div>
              </div>
              <p className={hintClass}>Type the warehouse name exactly as it is registered with Delhivery. Capital letters matter.</p>
              <details className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-200">Seller details on the parcel (optional)</summary>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                  <input aria-label="Seller name" className={inputClass} placeholder="Business name" value={dl.sellerName} disabled={disabled} onChange={(e) => setDl({ ...dl, sellerName: e.target.value })} />
                  <input aria-label="GSTIN" className={inputClass} placeholder="GSTIN" value={dl.gstin} disabled={disabled} onChange={(e) => setDl({ ...dl, gstin: e.target.value.toUpperCase() })} />
                  <input aria-label="Seller address" className={`${inputClass} sm:col-span-2`} placeholder="Address on the invoice" value={dl.sellerAddress} disabled={disabled} onChange={(e) => setDl({ ...dl, sellerAddress: e.target.value })} />
                </div>
              </details>
              <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-[#1D5BEA]" checked={!dl.live} disabled={disabled} onChange={(e) => setDl({ ...dl, live: !e.target.checked })} />
                This is a Delhivery test account (no real parcels)
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={primaryButton} disabled={disabled || !dl.warehouse || dl.pickupPin.length !== 6}>{busy === 'delhivery' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {view.delhivery.connected ? 'Save' : 'Connect Delhivery'}</button>
                {editing.delhivery && <button type="button" className={secondaryButton} onClick={() => setEditing({ ...editing, delhivery: false })}>Cancel</button>}
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Parcel and WhatsApp updates */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2"><Package size={16} className="text-slate-500" /><p className={heading}>Usual parcel</p></div>
        <p className="text-xs text-slate-500">Used when a product has no weight of its own. Couriers charge by weight and box size.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {([['weight_grams', 'Weight (g)'], ['length_cm', 'Length (cm)'], ['breadth_cm', 'Width (cm)'], ['height_cm', 'Height (cm)']] as const).map(([key, label]) => (
            <div key={key}>
              <label className={labelClass} htmlFor={`parcel-${key}`}>{label}</label>
              <input id={`parcel-${key}`} type="number" min={1} inputMode="decimal" className={inputClass} value={parcel[key]} disabled={disabled} onChange={(e) => setParcel({ ...parcel, [key]: Number(e.target.value) })} />
            </div>
          ))}
        </div>
        <label className="flex items-start gap-2 text-[13px] cursor-pointer">
          <input type="checkbox" className="h-4 w-4 mt-0.5 accent-[#1D5BEA]" checked={notify} disabled={disabled} onChange={(e) => setNotify(e.target.checked)} />
          <span>Tell the customer on WhatsApp as the parcel moves<span className={`block ${hintClass}`}>On the way (with the tracking link), out for delivery, delivered, or not delivered. Sent inside the 24-hour WhatsApp window.</span></span>
        </label>
        <button type="button" className={primaryButton} disabled={disabled} onClick={() => save('parcel', { parcel, notify }, 'Saved.')}>{busy === 'parcel' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button>
      </div>

      {/* Tracking updates pushed by the couriers */}
      {(view.shiprocket.connected || view.delhivery.connected) && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4 space-y-3">
          <div className="flex items-center gap-2"><KeyRound size={16} className="text-slate-500" /><p className={heading}>Live tracking updates</p></div>
          <p className="text-xs text-slate-500">
            WAMA checks every parcel by itself every 30 minutes. For updates the moment they happen, give the couriers this address and key.
          </p>
          <CopyLine label="Address" value={view.webhookUrl} onCopied={() => showToast('success', 'Address copied.')} />
          {view.webhookKey && <CopyLine label="Key (x-api-key)" value={view.webhookKey} onCopied={() => showToast('success', 'Key copied.')} />}
          <ul className="list-disc pl-5 text-xs text-slate-600 dark:text-slate-300 space-y-1">
            {view.shiprocket.connected && <li><b>Shiprocket:</b> Settings → API → Webhooks. Paste the address, switch it on, and paste the key as the security token.</li>}
            {view.delhivery.connected && <li><b>Delhivery:</b> email the address and key to your Delhivery account manager and ask them to push tracking scans to it, with the key in the &quot;x-api-key&quot; header. They take a few working days.</li>}
          </ul>
          {canManage && (
            <button type="button" className={secondaryButton} disabled={disabled} onClick={() => window.confirm('Make a new key? The old key stops working, so update it in Shiprocket and with Delhivery.') && save('webhook-key', {}, 'New key made. Update it with your courier partners.')}>
              <RefreshCw size={13} /> Make a new key
            </button>
          )}
        </div>
      )}
    </section>
  )
}

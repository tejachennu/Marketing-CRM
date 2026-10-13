'use client'

import { useState } from 'react'
import { AlertCircle, Check, CheckCircle2, Loader2, ShoppingBag, Sparkles } from 'lucide-react'
import { useAlert } from '@/lib/dialog-context'
import { DEFAULT_EXPRESS_FEE, SUPPORTED_PAYMENT_GATEWAYS, formatMoney, getExpressFee } from '@/lib/commerce/commerce-utils'
import { cardClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton, type ShowToast } from './ui'

const GATEWAY_LABELS: Record<string, string> = {
  razorpay: 'Razorpay',
  payu: 'PayU',
  billdesk: 'BillDesk',
  zaakpay: 'Zaakpay',
}

interface StoreSettingsProps {
  orgId: string
  orgData: Record<string, any>
  currency: string
  whatsappConnected: boolean
  /** Called with the saved values so the rest of the page (checklist, tabs) updates at once. */
  onSaved: (changes: Record<string, any>) => void
  showToast: ShowToast
}

export function StoreSettings({ orgId, orgData, currency, whatsappConnected, onSaved, showToast }: StoreSettingsProps) {
  const alert = useAlert()
  // The express charge is a setting only after the optional database update; until then it is fixed
  const expressFeeEditable = 'commerce_express_fee' in orgData
  // A store that was never set up is switched on by its first save; after that the switch decides
  const neverSetUp = !orgData.enable_commerce && !orgData.meta_catalog_id && !orgData.commerce_gateway_config_name && !orgData.commerce_address_flow_id

  const [form, setForm] = useState({
    enable_commerce: neverSetUp ? true : orgData.enable_commerce !== false,
    meta_catalog_id: orgData.meta_catalog_id || '',
    commerce_payment_gateway: (SUPPORTED_PAYMENT_GATEWAYS as readonly string[]).includes(orgData.commerce_payment_gateway) ? orgData.commerce_payment_gateway : 'razorpay',
    commerce_gateway_config_name: orgData.commerce_gateway_config_name || '',
    commerce_enable_cod: orgData.commerce_enable_cod !== false,
    commerce_default_shipping_fee: String(orgData.commerce_default_shipping_fee ?? '0'),
    commerce_free_shipping_threshold: String(orgData.commerce_free_shipping_threshold ?? '0'),
    commerce_express_fee: String(getExpressFee(orgData)),
    commerce_address_flow_id: orgData.commerce_address_flow_id || '',
  })
  const set = (changes: Partial<typeof form>) => setForm((current) => ({ ...current, ...changes }))

  const [isSaving, setIsSaving] = useState(false)
  const [detected, setDetected] = useState<{ catalogs: any[]; paymentConfigs: any[]; flows: any[]; commerceSettings: any | null } | null>(null)
  const [isDetecting, setIsDetecting] = useState(false)
  const [isDeployingFlow, setIsDeployingFlow] = useState(false)
  const [isEnablingCart, setIsEnablingCart] = useState(false)

  const hasGateway = Boolean(form.commerce_gateway_config_name.trim())
  const cartOn = detected?.commerceSettings ? detected.commerceSettings.is_cart_enabled === true && detected.commerceSettings.is_catalog_visible === true : null

  async function detectFromMeta() {
    setIsDetecting(true)
    try {
      const res = await fetch(`/api/commerce/meta-detect?organizationId=${orgId}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Meta could not be reached')
      setDetected({ catalogs: data.catalogs || [], paymentConfigs: data.paymentConfigs || [], flows: data.flows || [], commerceSettings: data.commerceSettings || null })
      showToast('success', `Found ${data.catalogs?.length || 0} catalog(s), ${data.paymentConfigs?.length || 0} payment setup(s) and ${data.flows?.length || 0} form(s). Pick them from the lists below.`)
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setIsDetecting(false)
    }
  }

  async function deployAddressFlow() {
    setIsDeployingFlow(true)
    try {
      const res = await fetch('/api/commerce/meta-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, action: 'deploy_address_flow' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.flowId) throw new Error(data.error || 'The address form could not be published')
      // The server already saved the ID; mirror it locally
      set({ commerce_address_flow_id: data.flowId })
      onSaved({ commerce_address_flow_id: data.flowId })
      showToast('success', 'The delivery address form is published and will be sent after each order.')
    } catch (err: any) {
      alert({ title: 'Address form not published', message: err.message })
    } finally {
      setIsDeployingFlow(false)
    }
  }

  async function enableCart() {
    setIsEnablingCart(true)
    try {
      const res = await fetch('/api/commerce/meta-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, action: 'enable_cart' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The cart could not be enabled')
      setDetected((current) => (current ? { ...current, commerceSettings: { ...(current.commerceSettings || {}), is_cart_enabled: true, is_catalog_visible: true } } : current))
      showToast('success', 'Cart and catalog are now visible on your WhatsApp number.')
    } catch (err: any) {
      alert({ title: 'Cart not enabled', message: err.message })
    } finally {
      setIsEnablingCart(false)
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const shippingFee = Number(form.commerce_default_shipping_fee)
    const freeAbove = Number(form.commerce_free_shipping_threshold)
    const expressFee = Number(form.commerce_express_fee)
    const amounts = [shippingFee, freeAbove, ...(expressFeeEditable ? [expressFee] : [])]
    if (amounts.some((amount) => !Number.isFinite(amount) || amount < 0)) {
      showToast('error', 'Shipping amounts must be 0 or more.')
      return
    }

    setIsSaving(true)
    try {
      const update: Record<string, any> = {
        enable_commerce: form.enable_commerce,
        meta_catalog_id: form.meta_catalog_id.trim() || null,
        commerce_payment_gateway: form.commerce_payment_gateway,
        commerce_gateway_config_name: form.commerce_gateway_config_name.trim() || null,
        commerce_enable_cod: form.commerce_enable_cod,
        commerce_default_shipping_fee: shippingFee,
        commerce_free_shipping_threshold: freeAbove,
        commerce_address_flow_id: form.commerce_address_flow_id.trim() || null,
        ...(expressFeeEditable ? { commerce_express_fee: expressFee } : {}),
      }
      const res = await fetch('/api/organization', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, updates: update }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Store settings could not be saved.')
      onSaved(update)
      showToast('success', form.enable_commerce ? 'Store settings saved.' : 'Store settings saved. The store is switched off, so new carts are not turned into orders.')
    } catch (err: any) {
      alert({ title: 'Settings not saved', message: err.message })
    } finally {
      setIsSaving(false)
    }
  }

  const heading = 'text-sm font-bold text-slate-900 dark:text-white'
  const subheading = 'text-xs text-slate-500 dark:text-slate-400'

  return (
    <form onSubmit={save} className="max-w-3xl space-y-4">
      {/* On / off */}
      <label className={`${cardClass} p-4 sm:p-5 flex items-center justify-between gap-4 cursor-pointer`}>
        <span>
          <span className={`block ${heading}`}>Take orders on WhatsApp</span>
          <span className={`block ${subheading}`}>
            {form.enable_commerce
              ? 'A cart sent from your catalog becomes an order, and the customer is taken through address and payment.'
              : 'Switched off: carts are not turned into orders and customers get no checkout messages.'}
          </span>
        </span>
        <span className="relative shrink-0">
          <input type="checkbox" role="switch" checked={form.enable_commerce} onChange={(event) => set({ enable_commerce: event.target.checked })} className="peer sr-only" />
          <span className="block h-6 w-11 rounded-full bg-slate-300 dark:bg-slate-700 peer-checked:bg-[#00a884] transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500/40" />
          <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
        </span>
      </label>

      <div className={`${cardClass} p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
        <div>
          <h2 className={heading}>Fill in from Meta</h2>
          <p className={subheading}>Looks up the catalogs, payment setups and forms on your WhatsApp Business account so you can pick them below.</p>
        </div>
        <button type="button" onClick={detectFromMeta} disabled={isDetecting || !whatsappConnected} title={whatsappConnected ? undefined : 'Connect WhatsApp in Settings first'} className={secondaryButton}>
          {isDetecting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {isDetecting ? 'Looking…' : 'Detect from Meta'}
        </button>
      </div>

      <section className={`${cardClass} p-4 sm:p-5 space-y-4`}>
        <div>
          <h2 className={heading}>Catalog</h2>
          <p className={subheading}>The Meta catalog whose products customers can add to a WhatsApp cart.</p>
        </div>
        <div>
          <label htmlFor="catalog-id" className={labelClass}>Meta catalog ID</label>
          {detected && detected.catalogs.length > 0 && (
            <select aria-label="Detected catalogs" value="" onChange={(event) => event.target.value && set({ meta_catalog_id: event.target.value })} className={`${inputClass} mb-2`}>
              <option value="">Choose a detected catalog…</option>
              {detected.catalogs.map((catalog) => (
                <option key={catalog.id} value={catalog.id}>
                  {catalog.name || 'Catalog'} · {catalog.product_count || 0} products
                </option>
              ))}
            </select>
          )}
          <input id="catalog-id" type="text" inputMode="numeric" placeholder="e.g. 102938475610293" value={form.meta_catalog_id} onChange={(event) => set({ meta_catalog_id: event.target.value })} className={inputClass} />
          <p className={hintClass}>Found in Meta Business Suite → Commerce Manager → Catalogs. The catalog must also be connected to your WhatsApp number there.</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60">
          <p className="text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2">
            {cartOn === true ? <CheckCircle2 size={15} className="shrink-0 mt-px text-emerald-500" /> : <ShoppingBag size={15} className="shrink-0 mt-px text-slate-400" />}
            <span>
              {cartOn === true
                ? 'The cart and catalog buttons are showing on your WhatsApp number.'
                : cartOn === false
                  ? 'The cart or catalog button is switched off on your WhatsApp number, so customers cannot send a cart.'
                  : 'Customers need the cart and catalog buttons on your WhatsApp number to send an order.'}
            </span>
          </p>
          {cartOn !== true && (
            <button type="button" onClick={enableCart} disabled={isEnablingCart || !whatsappConnected} className={`${secondaryButton} shrink-0`}>
              {isEnablingCart ? <Loader2 size={13} className="animate-spin" /> : <ShoppingBag size={13} />}
              {isEnablingCart ? 'Enabling…' : 'Enable cart'}
            </button>
          )}
        </div>
      </section>

      <section className={`${cardClass} p-4 sm:p-5 space-y-4`}>
        <div>
          <h2 className={heading}>Delivery address</h2>
          <p className={subheading}>Optional. When set, customers get an address form right after they send a cart, before they are asked to pay.</p>
        </div>
        <div>
          <label htmlFor="address-flow" className={labelClass}>Address form (Meta Flow ID)</label>
          {detected && detected.flows.length > 0 && (
            <select aria-label="Detected forms" value="" onChange={(event) => event.target.value && set({ commerce_address_flow_id: event.target.value })} className={`${inputClass} mb-2`}>
              <option value="">Choose one of your Meta forms…</option>
              {detected.flows.map((flow) => (
                <option key={flow.id} value={flow.id} disabled={flow.status !== 'PUBLISHED'}>
                  {flow.name} · {flow.status === 'PUBLISHED' ? 'published' : 'not published'}
                </option>
              ))}
            </select>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <input id="address-flow" type="text" inputMode="numeric" placeholder="Leave empty to skip the address step" value={form.commerce_address_flow_id} onChange={(event) => set({ commerce_address_flow_id: event.target.value })} className={inputClass} />
            <button type="button" onClick={deployAddressFlow} disabled={isDeployingFlow || !whatsappConnected} className={`${secondaryButton} shrink-0`}>
              {isDeployingFlow ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {isDeployingFlow ? 'Publishing…' : 'Create the standard form'}
            </button>
          </div>
          <p className={hintClass}>
            “Create the standard form” publishes a ready-made address form to your WhatsApp account and saves its ID here. It shows the express delivery charge set below, so save the shipping section first if you change that. A custom form must start on a screen named SHIPPING_DETAILS.
          </p>
        </div>
      </section>

      <section className={`${cardClass} p-4 sm:p-5 space-y-4`}>
        <div>
          <h2 className={heading}>Payment</h2>
          <p className={subheading}>
            {hasGateway && form.commerce_enable_cod
              ? 'Customers choose between paying online in the chat and Cash on Delivery.'
              : hasGateway
                ? 'Customers are asked to pay online in the chat.'
                : form.commerce_enable_cod
                  ? 'Customers confirm the order as Cash on Delivery with one tap.'
                  : 'Choose at least one way for customers to pay.'}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="gateway" className={labelClass}>Payment gateway</label>
            <select id="gateway" value={form.commerce_payment_gateway} onChange={(event) => set({ commerce_payment_gateway: event.target.value })} className={inputClass}>
              {SUPPORTED_PAYMENT_GATEWAYS.map((gateway) => (
                <option key={gateway} value={gateway}>{GATEWAY_LABELS[gateway]}</option>
              ))}
            </select>
            <p className={hintClass}>In-chat payment is offered by WhatsApp for businesses in India, in rupees.</p>
          </div>
          <div>
            <label htmlFor="gateway-config" className={labelClass}>Gateway configuration name</label>
            {detected && detected.paymentConfigs.length > 0 && (
              <select
                aria-label="Detected payment setups"
                value=""
                onChange={(event) => {
                  const found = detected.paymentConfigs.find((config) => config.configuration_name === event.target.value)
                  if (!found) return
                  const gateway = String(found.provider_name || found.payment_gateway || '').toLowerCase()
                  set({
                    commerce_gateway_config_name: found.configuration_name,
                    commerce_payment_gateway: (SUPPORTED_PAYMENT_GATEWAYS as readonly string[]).includes(gateway) ? gateway : form.commerce_payment_gateway,
                  })
                }}
                className={`${inputClass} mb-2`}
              >
                <option value="">Choose a detected setup…</option>
                {detected.paymentConfigs.map((config) => (
                  <option key={config.configuration_name} value={config.configuration_name}>
                    {config.configuration_name} · {config.provider_name || config.payment_gateway || 'gateway'}
                  </option>
                ))}
              </select>
            )}
            <input id="gateway-config" type="text" placeholder="Leave empty if you only take COD" value={form.commerce_gateway_config_name} onChange={(event) => set({ commerce_gateway_config_name: event.target.value })} className={inputClass} />
            <p className={hintClass}>The name you gave the payment setup in WhatsApp Manager → Payments. It must match exactly.</p>
          </div>
        </div>
        <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 cursor-pointer">
          <input type="checkbox" checked={form.commerce_enable_cod} onChange={(event) => set({ commerce_enable_cod: event.target.checked })} className="mt-0.5 h-4 w-4 rounded accent-[#00a884]" />
          <span className="text-xs">
            <span className="block font-semibold text-slate-900 dark:text-white">Allow Cash on Delivery</span>
            <span className="block text-slate-500 dark:text-slate-400">Customers confirm the order with one tap and pay when it arrives.</span>
          </span>
        </label>
        {!hasGateway && !form.commerce_enable_cod && (
          <p role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-200">
            <AlertCircle size={15} className="shrink-0 mt-px" />
            With no gateway and no Cash on Delivery, customers can place an order but cannot pay in the chat. They will only be told that your team will contact them.
          </p>
        )}
      </section>

      <section className={`${cardClass} p-4 sm:p-5 space-y-4`}>
        <div>
          <h2 className={heading}>Shipping</h2>
          <p className={subheading}>Amounts are in {currency}, your workspace currency.</p>
        </div>
        <div className={`grid grid-cols-1 gap-4 ${expressFeeEditable ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          <div>
            <label htmlFor="shipping-fee" className={labelClass}>Shipping fee</label>
            <input id="shipping-fee" type="number" min={0} step="0.01" value={form.commerce_default_shipping_fee} onChange={(event) => set({ commerce_default_shipping_fee: event.target.value })} className={inputClass} />
            <p className={hintClass}>Added to every order.</p>
          </div>
          <div>
            <label htmlFor="free-shipping" className={labelClass}>Free shipping on orders from</label>
            <input id="free-shipping" type="number" min={0} step="0.01" value={form.commerce_free_shipping_threshold} onChange={(event) => set({ commerce_free_shipping_threshold: event.target.value })} className={inputClass} />
            <p className={hintClass}>Use 0 to always charge the shipping fee.</p>
          </div>
          {expressFeeEditable && (
            <div>
              <label htmlFor="express-fee" className={labelClass}>Express delivery charge</label>
              <input id="express-fee" type="number" min={0} step="0.01" value={form.commerce_express_fee} onChange={(event) => set({ commerce_express_fee: event.target.value })} className={inputClass} />
              <p className={hintClass}>Added when the customer picks express in the address form.</p>
            </div>
          )}
        </div>
        {!expressFeeEditable && (
          <p className={hintClass}>
            Customers who pick express delivery in the address form are charged a further {formatMoney(DEFAULT_EXPRESS_FEE, currency)}. To set your own amount, ask your developer to run the optional update <span className="font-mono">scripts/db-migration-v34-commerce.js</span>.
          </p>
        )}
      </section>

      <div className="flex justify-end">
        <button type="submit" disabled={isSaving} className={primaryButton}>
          {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
          {isSaving ? 'Saving…' : 'Save store settings'}
        </button>
      </div>
    </form>
  )
}

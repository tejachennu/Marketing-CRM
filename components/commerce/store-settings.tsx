'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, CheckCircle2, Link2, Loader2, Pencil, Plus, RefreshCw, ShoppingBag, Sparkles, Trash2, Unlink } from 'lucide-react'
import { useAlert, useConfirm } from '@/lib/dialog-context'
import { loadMetaSdk } from '@/lib/meta-sdk'
import { DEFAULT_EXPRESS_FEE, SUPPORTED_PAYMENT_GATEWAYS, formatMoney, getExpressFee } from '@/lib/commerce/commerce-utils'
import { cardClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton, type ShowToast } from './ui'

const GATEWAY_LABELS: Record<string, string> = {
  razorpay: 'Razorpay',
  payu: 'PayU',
  billdesk: 'BillDesk',
  zaakpay: 'Zaakpay',
}

/** The store's catalog as Meta sees it, from /api/commerce/catalog. */
interface CatalogInfo {
  linkedCatalogId: string | null
  linkedError: string | null
  connectionKnown: boolean
  catalogs: Array<{ id: string; name: string; product_count: number; connected: boolean }>
  businessId: string | null
  /** Whether this WhatsApp connection may change the catalog; null when Meta would not say. */
  canEdit: boolean | null
  canCreate: boolean | null
  /** Catalog calls use a separate "Connect catalog with Meta" connection. */
  catalogConnection?: boolean
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
  // The AI assistant switch needs its column (supabase/migrations/20261018_commerce_ai_assistant.sql)
  const assistantEditable = 'commerce_ai_assistant' in orgData
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
    commerce_ai_assistant: orgData.commerce_ai_assistant !== false,
  })
  const set = (changes: Partial<typeof form>) => setForm((current) => ({ ...current, ...changes }))

  const [isSaving, setIsSaving] = useState(false)
  // What Meta reports for the WhatsApp Business account: the choices below come only from here
  const [detected, setDetected] = useState<{
    businessId: string | null
    businessName: string | null
    catalogs: any[]
    catalogsError: string | null
    paymentConfigs: any[]
    paymentConfigsError: string | null
    flows: any[]
    flowsError: string | null
    commerceSettings: any | null
  } | null>(null)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [isDetecting, setIsDetecting] = useState(false)
  const [isDeployingFlow, setIsDeployingFlow] = useState(false)
  const [isEnablingCart, setIsEnablingCart] = useState(false)

  const [catalogInfo, setCatalogInfo] = useState<CatalogInfo | null>(null)
  const [isConnectingCatalog, setIsConnectingCatalog] = useState(false)
  const [newCatalog, setNewCatalog] = useState<{ name: string; businessId: string } | null>(null)
  const [isCreatingCatalog, setIsCreatingCatalog] = useState(false)
  const confirm = useConfirm()
  const [renameTo, setRenameTo] = useState<string | null>(null)
  const [catalogAction, setCatalogAction] = useState<'rename' | 'unlink' | 'delete' | null>(null)
  const [isConnectingAccess, setIsConnectingAccess] = useState(false)
  // A Facebook Login for Business configuration that asks for catalog_management (not the WhatsApp signup one)
  const catalogLoginConfigId = process.env.NEXT_PUBLIC_META_CATALOG_CONFIG_ID || ''

  const loadCatalogInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/commerce/catalog?organizationId=${orgId}`)
      const data = await res.json().catch(() => ({}))
      if (res.ok) setCatalogInfo(data)
      return res.ok ? (data as CatalogInfo) : null
    } catch {
      return null // The catalog status is extra information; the settings work without it
    }
  }, [orgId])

  // Everything Meta knows is read when the screen opens; "Refresh from Meta" reads it again
  useEffect(() => {
    if (whatsappConnected) detectFromMeta(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whatsappConnected, orgId])

  const chosenCatalogId = form.meta_catalog_id.trim()
  const chosenCatalog = catalogInfo?.catalogs.find((catalog) => catalog.id === chosenCatalogId) || null
  const isLinkedCatalog = Boolean(catalogInfo && chosenCatalogId && chosenCatalogId === catalogInfo.linkedCatalogId)

  async function connectCatalog() {
    setIsConnectingCatalog(true)
    try {
      const res = await fetch('/api/commerce/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, action: 'connect', catalogId: chosenCatalogId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The catalog could not be connected')
      // The server saved the catalog as this store's; mirror it locally
      onSaved({ meta_catalog_id: data.catalogId })
      await loadCatalogInfo()
      showToast('success', 'The catalog is connected to your WhatsApp account. Its products can now be sent and ordered in chats.')
    } catch (err: any) {
      alert({ title: 'Catalog not connected', message: err.message })
    } finally {
      setIsConnectingCatalog(false)
    }
  }

  async function createCatalog(event: React.FormEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (!newCatalog) return
    setIsCreatingCatalog(true)
    try {
      const res = await fetch('/api/commerce/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, action: 'create', name: newCatalog.name, businessId: detected?.businessId || catalogInfo?.businessId || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The catalog could not be created')
      set({ meta_catalog_id: data.catalogId })
      onSaved({ meta_catalog_id: data.catalogId })
      setNewCatalog(null)
      await loadCatalogInfo()
      if (data.connected) showToast('success', 'Your catalog was created and connected to WhatsApp. Add products in the Products tab.')
      else alert({ title: 'Catalog created, but not connected', message: `The catalog was created and saved here. Connecting it to your WhatsApp account did not work: ${data.connectError || 'Meta did not say why.'} Press “Connect to WhatsApp” to try again.` })
    } catch (err: any) {
      alert({ title: 'Catalog not created', message: err.message })
    } finally {
      setIsCreatingCatalog(false)
    }
  }

  /** Rename or delete the store's own catalog in Meta, or stop using it here. */
  async function changeCatalog(action: 'rename' | 'unlink' | 'delete', extra: Record<string, string> = {}) {
    setCatalogAction(action)
    try {
      const res = await fetch('/api/commerce/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, action, ...extra }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The catalog could not be changed')
      if (action === 'rename') {
        setRenameTo(null)
        showToast('success', 'The catalog was renamed.')
      } else {
        // The server unlinked the catalog from this store; mirror it locally
        set({ meta_catalog_id: '' })
        onSaved({ meta_catalog_id: '' })
        showToast(
          'success',
          action === 'delete'
            ? `The catalog was deleted in Meta.${data.productsReset ? ` ${data.productsReset} product${data.productsReset === 1 ? ' stays' : 's stay'} here, ready for another catalog.` : ''}`
            : 'This store no longer uses the catalog. It is still connected to your WhatsApp account until you disconnect it in WhatsApp Manager.'
        )
      }
      await loadCatalogInfo()
    } catch (err: any) {
      alert({ title: 'Catalog not changed', message: err.message })
    } finally {
      setCatalogAction(null)
    }
  }

  /** Ask the business, in Meta's window, for access to its catalog. */
  async function connectCatalogAccess() {
    if (window.location.protocol !== 'https:') {
      alert({ title: 'Needs https', message: 'Meta’s sign-in only works over https. Locally, run "npm run dev:https" and open https://localhost:3000.' })
      return
    }
    setIsConnectingAccess(true)
    try {
      const FB = await loadMetaSdk(process.env.NEXT_PUBLIC_META_APP_ID || '1747554262928162')
      const code = await new Promise<string | null>((resolve) => {
        FB.login((response: any) => resolve(response?.authResponse?.code || null), {
          config_id: catalogLoginConfigId,
          response_type: 'code',
          override_default_response_type: true,
        })
      })
      if (!code) return // Closed without granting access
      const res = await fetch('/api/commerce/catalog/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Catalog access could not be saved')
      if (data.linkedCatalogId) {
        set({ meta_catalog_id: data.linkedCatalogId })
        onSaved({ meta_catalog_id: data.linkedCatalogId })
      }
      await loadCatalogInfo()
      showToast('success', 'Your catalog is connected. Products you add, change or delete here are now sent to Meta.')
    } catch (err: any) {
      alert({ title: 'Catalog not connected', message: err.message })
    } finally {
      setIsConnectingAccess(false)
    }
  }

  async function removeCatalogAccess() {
    const confirmed = await confirm({
      title: 'Remove catalog access?',
      message: 'Products will no longer be sent to your Meta catalog from here. The catalog and its products stay in Meta.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!confirmed) return
    try {
      const res = await fetch(`/api/commerce/catalog/access?organizationId=${orgId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Catalog access could not be removed')
      await loadCatalogInfo()
      showToast('success', 'Catalog access removed.')
    } catch (err: any) {
      alert({ title: 'Not removed', message: err.message })
    }
  }

  async function unlinkCatalog() {
    const confirmed = await confirm({
      title: 'Stop using this catalog here?',
      message: 'Products are no longer synced with it or sent from it in this dashboard. The catalog and its products stay in Meta. It also stays connected to your WhatsApp account: to remove it from WhatsApp, open WhatsApp Manager > Account tools > Catalog and disconnect it there (Meta offers no way to do this from here).',
      confirmLabel: 'Stop using',
      destructive: true,
    })
    if (confirmed) await changeCatalog('unlink')
  }

  async function deleteLinkedCatalog() {
    const linkedId = catalogInfo?.linkedCatalogId
    if (!linkedId) return
    const confirmed = await confirm({
      title: 'Delete the catalog in Meta?',
      message: `This permanently deletes the catalog ${chosenCatalog?.name ? `“${chosenCatalog.name}” ` : ''}and every product in it from Meta, for WhatsApp and anything else using it. Your products stay in this dashboard. This cannot be undone.`,
      confirmLabel: 'Delete catalog',
      destructive: true,
    })
    if (confirmed) await changeCatalog('delete', { confirm: linkedId })
  }

  // Catalogs to pick from: Meta's full answer when there is one, otherwise what "Detect" found
  const catalogOptions: Array<{ id: string; name: string; product_count: number; connected?: boolean }> = catalogInfo?.catalogs.length ? catalogInfo.catalogs : detected?.catalogs || []

  const hasGateway = Boolean(form.commerce_gateway_config_name.trim())
  const cartOn = detected?.commerceSettings ? detected.commerceSettings.is_cart_enabled === true && detected.commerceSettings.is_catalog_visible === true : null

  async function detectFromMeta(quiet = false) {
    setIsDetecting(true)
    try {
      const [res] = await Promise.all([fetch(`/api/commerce/meta-detect?organizationId=${orgId}`), loadCatalogInfo()])
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Meta could not be reached')
      if (data.success === false) {
        // The connection itself failed (expired or removed): say so instead of showing empty lists
        setDetected(null)
        setDetectError(data.connectionError || 'Meta could not be reached')
        return
      }
      setDetectError(null)
      setDetected({
        businessId: data.businessId || null,
        businessName: data.businessName || null,
        catalogs: data.catalogs || [],
        catalogsError: data.catalogsError || null,
        paymentConfigs: data.paymentConfigs || [],
        paymentConfigsError: data.paymentConfigsError || null,
        flows: data.flows || [],
        flowsError: data.flowsError || null,
        commerceSettings: data.commerceSettings || null,
      })
      if (!quiet) showToast('success', 'Refreshed from Meta.')
    } catch (err: any) {
      setDetectError(err.message)
    } finally {
      setIsDetecting(false)
    }
  }

  // Payment setups and forms Meta reports, and the one a choice of setup means for the gateway
  const paymentSetups: any[] = detected?.paymentConfigs || []
  const publishedFlows: any[] = (detected?.flows || []).filter((flow) => flow.status === 'PUBLISHED')
  function choosePaymentSetup(name: string) {
    const found = paymentSetups.find((config) => config.configuration_name === name)
    const gateway = String(found?.provider_name || '').toLowerCase()
    set({
      commerce_gateway_config_name: name,
      commerce_payment_gateway: (SUPPORTED_PAYMENT_GATEWAYS as readonly string[]).includes(gateway) ? gateway : form.commerce_payment_gateway,
    })
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
      detectFromMeta(true)
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
        ...(assistantEditable ? { commerce_ai_assistant: form.commerce_ai_assistant } : {}),
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

      {/* AI shopping assistant */}
      <label className={`${cardClass} p-4 sm:p-5 flex items-center justify-between gap-4 ${assistantEditable ? 'cursor-pointer' : ''}`}>
        <span>
          <span className={`block ${heading}`}>AI shopping assistant</span>
          <span className={`block ${subheading}`}>
            {!assistantEditable
              ? 'On. Answers product and order questions in the chat with your own products and the customer\'s orders. To be able to switch it off here, run the database update supabase/migrations/20261018_commerce_ai_assistant.sql.'
              : form.commerce_ai_assistant
                ? 'Answers “do you have…” and “where is my order?” in the chat: it searches your products, sends product cards and reads the customer\'s own orders. Other questions go to your FAQ chatbot. Needs the AI chatbot to be on.'
                : 'Off: product and order questions go to your FAQ chatbot like any other message.'}
          </span>
        </span>
        <span className="relative shrink-0">
          <input type="checkbox" role="switch" checked={assistantEditable ? form.commerce_ai_assistant : true} disabled={!assistantEditable} onChange={(event) => set({ commerce_ai_assistant: event.target.checked })} className="peer sr-only" />
          <span className="block h-6 w-11 rounded-full bg-slate-300 dark:bg-slate-700 peer-checked:bg-[#00a884] peer-disabled:opacity-60 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500/40" />
          <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
        </span>
      </label>

      <div className={`${cardClass} p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
        <div>
          <h2 className={heading}>From your WhatsApp Business account</h2>
          <p className={subheading}>
            {!whatsappConnected
              ? 'Connect WhatsApp in Settings first: the catalog, payment setup and address form are chosen from it.'
              : detected
                ? `Catalogs, payment setups and forms are read from Meta${detected.businessName ? ` for ${detected.businessName}` : ''}.`
                : detectError
                  ? 'Meta could not be read.'
                  : 'Reading your catalogs, payment setups and forms from Meta…'}
          </p>
          {detectError && (
            <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-red-700 dark:text-red-300">
              <AlertCircle size={14} className="shrink-0 mt-px" /> {detectError}
            </p>
          )}
        </div>
        <button type="button" onClick={() => detectFromMeta()} disabled={isDetecting || !whatsappConnected} title={whatsappConnected ? undefined : 'Connect WhatsApp in Settings first'} className={`${secondaryButton} shrink-0`}>
          {isDetecting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {isDetecting ? 'Reading…' : 'Refresh from Meta'}
        </button>
      </div>

      <section className={`${cardClass} p-4 sm:p-5 space-y-4`}>
        <div>
          <h2 className={heading}>Catalog</h2>
          <p className={subheading}>The Meta catalog whose products customers can add to a WhatsApp cart.</p>
        </div>
        <div>
          <label htmlFor="catalog-id" className={labelClass}>Catalog</label>
          <select id="catalog-id" value={form.meta_catalog_id} onChange={(event) => set({ meta_catalog_id: event.target.value })} disabled={!whatsappConnected} className={inputClass}>
            <option value="">{catalogOptions.length > 0 ? 'Choose your catalog…' : 'No catalog found on Meta'}</option>
            {form.meta_catalog_id && !catalogOptions.some((catalog) => catalog.id === form.meta_catalog_id) && (
              <option value={form.meta_catalog_id}>Saved catalog {form.meta_catalog_id} (not listed by Meta right now)</option>
            )}
            {catalogOptions.map((catalog) => (
              <option key={catalog.id} value={catalog.id}>
                {catalog.name || 'Catalog'} · {catalog.product_count || 0} products{catalog.connected ? ' · connected to WhatsApp' : ''}
              </option>
            ))}
          </select>
          <p className={hintClass}>
            {detected?.catalogsError && catalogOptions.length === 0
              ? `Meta did not list your catalogs: ${detected.catalogsError}`
              : 'Read from your WhatsApp Business account. WhatsApp sells from one catalog per account.'}
          </p>
        </div>

        {/* What Meta says about the chosen catalog */}
        {catalogInfo && chosenCatalogId && (
          <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
            {isLinkedCatalog && catalogInfo.linkedError && (
              <li role="alert" className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
                <AlertCircle size={15} className="shrink-0 mt-px" /> {catalogInfo.linkedError}
              </li>
            )}
            {chosenCatalog && (
              <li className="flex items-start gap-2">
                <CheckCircle2 size={15} className="shrink-0 mt-px text-emerald-500" />
                <span><strong className="font-semibold text-slate-900 dark:text-white">{chosenCatalog.name}</strong> has {chosenCatalog.product_count} product{chosenCatalog.product_count === 1 ? '' : 's'} on Meta.</span>
              </li>
            )}
            {chosenCatalog && catalogInfo.connectionKnown && (
              chosenCatalog.connected ? (
                <li className="flex items-start gap-2">
                  <CheckCircle2 size={15} className="shrink-0 mt-px text-emerald-500" /> It is connected to your WhatsApp account.
                </li>
              ) : (
                <li className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-100">
                  <span className="flex items-start gap-2">
                    <AlertCircle size={15} className="shrink-0 mt-px" />
                    It is not connected to your WhatsApp account, so its products cannot be sent or ordered in chats yet.
                  </span>
                  <button type="button" onClick={connectCatalog} disabled={isConnectingCatalog} className={`${secondaryButton} shrink-0`}>
                    {isConnectingCatalog ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                    {isConnectingCatalog ? 'Connecting…' : 'Connect to WhatsApp'}
                  </button>
                </li>
              )
            )}
            {isLinkedCatalog && catalogInfo.canEdit === true && (
              <li className="flex items-start gap-2">
                <CheckCircle2 size={15} className="shrink-0 mt-px text-emerald-500" /> Products you add or change in the Products tab are sent to this catalog.
              </li>
            )}
            {isLinkedCatalog && catalogInfo.canEdit === false && (
              <li className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
                <AlertCircle size={15} className="shrink-0 mt-px" />
                <span>
                  This WhatsApp connection can read the catalog but not change it, so products added here stay out of WhatsApp. To manage the catalog from here, reconnect WhatsApp and include the catalog, or use an access token that has the <span className="font-mono">catalog_management</span> permission.
                </span>
              </li>
            )}
            {!isLinkedCatalog && <li className={hintClass}>Save the store settings to use this catalog.</li>}
            {isLinkedCatalog && (
              <li className="pt-1">
                {renameTo !== null ? (
                  <form
                    className="flex flex-col sm:flex-row gap-2"
                    onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); changeCatalog('rename', { name: renameTo }) }}
                  >
                    <input autoFocus value={renameTo} onChange={(event) => setRenameTo(event.target.value)} maxLength={100} aria-label="New catalog name" className={inputClass} />
                    <button type="submit" disabled={!renameTo.trim() || catalogAction !== null} className={`${primaryButton} shrink-0`}>
                      {catalogAction === 'rename' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save name
                    </button>
                    <button type="button" onClick={() => setRenameTo(null)} className={`${secondaryButton} shrink-0`}>Cancel</button>
                  </form>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {catalogInfo.canEdit === true && (
                      <button type="button" onClick={() => setRenameTo(chosenCatalog?.name || '')} disabled={catalogAction !== null} className={secondaryButton}>
                        <Pencil size={13} /> Rename
                      </button>
                    )}
                    <button type="button" onClick={unlinkCatalog} disabled={catalogAction !== null} className={secondaryButton}>
                      {catalogAction === 'unlink' ? <Loader2 size={13} className="animate-spin" /> : <Unlink size={13} />} Stop using here
                    </button>
                    {catalogInfo.canEdit === true && (
                      <button type="button" onClick={deleteLinkedCatalog} disabled={catalogAction !== null} className={`${secondaryButton} text-red-600 dark:text-red-400`}>
                        {catalogAction === 'delete' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete catalog
                      </button>
                    )}
                  </div>
                )}
              </li>
            )}
          </ul>
        )}

        {/* Catalog access: the WhatsApp signup does not include it, so it is granted separately */}
        {whatsappConnected && catalogInfo && catalogLoginConfigId && (
          catalogInfo.catalogConnection ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-900 dark:text-emerald-100">
              <span className="flex items-start gap-2"><CheckCircle2 size={15} className="shrink-0 mt-px" /> Your catalog is connected with Meta. Products are added, changed and deleted there from here.</span>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={connectCatalogAccess} disabled={isConnectingAccess} className={secondaryButton}>
                  {isConnectingAccess ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} Reconnect
                </button>
                <button type="button" onClick={removeCatalogAccess} disabled={isConnectingAccess} className={`${secondaryButton} text-red-600 dark:text-red-400`}>Remove</button>
              </div>
            </div>
          ) : catalogInfo.canEdit !== true ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200">
              <span>To add, change and delete products in your Meta catalog from here, give access to your catalog in Meta&apos;s window.</span>
              <button type="button" onClick={connectCatalogAccess} disabled={isConnectingAccess} className={`${primaryButton} shrink-0`}>
                {isConnectingAccess ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} Connect catalog with Meta
              </button>
            </div>
          ) : null
        )}

        {/* A store with no catalog can make one here */}
        {whatsappConnected && (
          newCatalog ? (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 space-y-3">
              <div>
                <label htmlFor="new-catalog-name" className={labelClass}>Catalog name</label>
                <input id="new-catalog-name" type="text" maxLength={100} autoFocus value={newCatalog.name} onChange={(event) => setNewCatalog({ ...newCatalog, name: event.target.value })} className={inputClass} />
                <p className={hintClass}>
                  {detected?.businessName
                    ? `Created in your business portfolio “${detected.businessName}” and connected to your WhatsApp account.`
                    : 'Created in the business portfolio that owns your WhatsApp account, and connected to it.'}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setNewCatalog(null)} className={secondaryButton}>Cancel</button>
                <button type="button" onClick={createCatalog} disabled={isCreatingCatalog || !newCatalog.name.trim()} className={primaryButton}>
                  {isCreatingCatalog ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
                  {isCreatingCatalog ? 'Creating…' : 'Create and connect'}
                </button>
              </div>
            </div>
          ) : (
            !chosenCatalogId && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  No catalog yet? Create one on Meta and connect it to your WhatsApp account in one step.
                  {catalogInfo?.canCreate === false && ' This needs a WhatsApp connection that is allowed to manage catalogs.'}
                </p>
                <button type="button" onClick={() => setNewCatalog({ name: `${orgData.name || 'My store'} catalog`, businessId: '' })} className={`${secondaryButton} shrink-0`}>
                  <Plus size={13} /> Create a catalog
                </button>
              </div>
            )
          )
        )}

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
          <label htmlFor="address-flow" className={labelClass}>Address form</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <select id="address-flow" value={form.commerce_address_flow_id} onChange={(event) => set({ commerce_address_flow_id: event.target.value })} disabled={!whatsappConnected} className={inputClass}>
              <option value="">No address step</option>
              {form.commerce_address_flow_id && !publishedFlows.some((flow) => flow.id === form.commerce_address_flow_id) && (
                <option value={form.commerce_address_flow_id}>Saved form {form.commerce_address_flow_id}{detected ? ' (not published on Meta)' : ''}</option>
              )}
              {publishedFlows.map((flow) => (
                <option key={flow.id} value={flow.id}>{flow.name}</option>
              ))}
            </select>
            <button type="button" onClick={deployAddressFlow} disabled={isDeployingFlow || !whatsappConnected} className={`${secondaryButton} shrink-0`}>
              {isDeployingFlow ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {isDeployingFlow ? 'Publishing…' : 'Create the standard form'}
            </button>
          </div>
          <p className={hintClass}>
            {detected?.flowsError
              ? `Meta did not list your forms: ${detected.flowsError}`
              : 'Your published WhatsApp forms. “Create the standard form” publishes a ready-made address form and selects it; it shows the express delivery charge set below, so save the shipping section first if you change that. A custom form must start on a screen named SHIPPING_DETAILS.'}
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
        <div>
          <label htmlFor="gateway-config" className={labelClass}>Online payment</label>
          <select id="gateway-config" value={form.commerce_gateway_config_name} onChange={(event) => choosePaymentSetup(event.target.value)} disabled={!whatsappConnected} className={inputClass}>
            <option value="">No online payment</option>
            {form.commerce_gateway_config_name && !paymentSetups.some((config) => config.configuration_name === form.commerce_gateway_config_name) && (
              <option value={form.commerce_gateway_config_name}>
                Saved setup “{form.commerce_gateway_config_name}” · {GATEWAY_LABELS[form.commerce_payment_gateway] || form.commerce_payment_gateway}{detected ? ' (not found on Meta)' : ''}
              </option>
            )}
            {paymentSetups.map((config) => {
              const provider = String(config.provider_name || '').toLowerCase()
              const supported = (SUPPORTED_PAYMENT_GATEWAYS as readonly string[]).includes(provider)
              return (
                <option key={config.configuration_name} value={config.configuration_name} disabled={!supported}>
                  {config.configuration_name} · {GATEWAY_LABELS[provider] || config.provider_name || 'gateway'}
                  {config.status ? ` · ${config.status}` : ''}
                  {supported ? '' : ' · not supported here'}
                </option>
              )
            })}
          </select>
          <p className={hintClass}>
            {detected?.paymentConfigsError
              ? `Meta did not list your payment setups: ${detected.paymentConfigsError}`
              : detected && paymentSetups.length === 0
                ? 'No payment setup on your WhatsApp account yet. Add one in WhatsApp Manager → Payments (Razorpay, PayU, BillDesk or Zaakpay), then Refresh from Meta.'
                : 'Payment setups on your WhatsApp account (WhatsApp Manager → Payments). In-chat payment is for businesses in India, in rupees.'}
          </p>
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

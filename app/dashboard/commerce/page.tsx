'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShoppingBag,
  Sparkles,
  Trash2,
  Truck,
  Wallet,
  X,
} from 'lucide-react'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { useAlert, useConfirm } from '@/lib/dialog-context'
import { authSessionManager } from '@/lib/auth-context'
import type { CommerceOrder, CommerceProduct } from '@/lib/types'
import {
  OPEN_CHECKOUT_STATUSES,
  ORDER_STATUS_LABELS,
  SUPPORTED_PAYMENT_GATEWAYS,
  formatMoney,
  getCommerceSetup,
  getNextOrderStatuses,
  isRevenueOrder,
  type OrderStatus,
} from '@/lib/commerce/commerce-utils'

type Tab = 'orders' | 'products' | 'settings'
type OrderFilter = 'all' | 'awaiting' | 'to_ship' | 'shipped' | 'delivered' | 'canceled'

// ── Shared styles ────────────────────────────────────────────────────────────
const cardClass = 'bg-white dark:bg-[#111b21] rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-[0_1px_2px_rgba(11,20,26,0.05)]'
const inputClass =
  'w-full px-3 py-2 text-[13px] rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60'
const labelClass = 'block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1'
const hintClass = 'text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 mt-1'
const primaryButton =
  'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-[#008069] hover:bg-[#006d59] text-white text-xs font-bold shadow-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'
const secondaryButton =
  'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'

const STATUS_STYLES: Record<OrderStatus, string> = {
  cart_submitted: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  awaiting_address: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  payment_pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  cod_confirmed: 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300',
  shipped: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
  delivered: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300',
  canceled: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
}

const ORDER_FILTERS: Array<{ id: OrderFilter; label: string; matches: (status: string) => boolean }> = [
  { id: 'all', label: 'All', matches: () => true },
  { id: 'awaiting', label: 'Awaiting customer', matches: (status) => OPEN_CHECKOUT_STATUSES.includes(status as OrderStatus) },
  { id: 'to_ship', label: 'To ship', matches: (status) => status === 'paid' || status === 'cod_confirmed' },
  { id: 'shipped', label: 'Shipped', matches: (status) => status === 'shipped' },
  { id: 'delivered', label: 'Delivered', matches: (status) => status === 'delivered' },
  { id: 'canceled', label: 'Canceled', matches: (status) => status === 'canceled' },
]

const ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  paid: 'Mark as paid',
  cod_confirmed: 'Confirm as Cash on Delivery',
  shipped: 'Mark as shipped',
  delivered: 'Mark as delivered',
  canceled: 'Cancel order',
}

const GATEWAY_LABELS: Record<string, string> = {
  razorpay: 'Razorpay',
  payu: 'PayU',
  billdesk: 'BillDesk',
  zaakpay: 'Zaakpay',
}

const EMPTY_PRODUCT = { title: '', retailer_id: '', price: '', currency: 'INR', description: '', image_url: '', website_url: '', category: '', inventory_count: '' }

function customerName(order: CommerceOrder): string {
  return [order.contact?.first_name, order.contact?.last_name].filter(Boolean).join(' ') || order.shipping_address?.full_name || 'Customer'
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${STATUS_STYLES[status as OrderStatus] || STATUS_STYLES.cart_submitted}`}>
      {ORDER_STATUS_LABELS[status as OrderStatus] || status}
    </span>
  )
}

function Metric({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: typeof Package; tone: string }) {
  return (
    <div className={`${cardClass} p-4`}>
      <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
        <span>{label}</span>
        <Icon size={16} className={tone} />
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{note}</div>
    </div>
  )
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`bg-white dark:bg-[#111b21] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full ${wide ? 'max-w-lg' : 'max-w-md'} max-h-[calc(100dvh-2rem)] overflow-y-auto`}>
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 bg-white dark:bg-[#111b21] border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white">{title}</h3>
          <button type="button" aria-label="Close" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export default function CommercePage() {
  const alert = useAlert()
  const confirm = useConfirm()

  const [activeTab, setActiveTab] = useState<Tab>('orders')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgData, setOrgData] = useState<Record<string, any> | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  // Orders
  const [orders, setOrders] = useState<CommerceOrder[]>([])
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all')
  const [orderSearch, setOrderSearch] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null)
  const [notifyCustomer, setNotifyCustomer] = useState(true)
  const [trackingNumber, setTrackingNumber] = useState('')

  // Products
  const [products, setProducts] = useState<CommerceProduct[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [isSyncing, setIsSyncing] = useState(false)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [newProduct, setNewProduct] = useState(EMPTY_PRODUCT)
  const [productError, setProductError] = useState('')
  const [isSavingProduct, setIsSavingProduct] = useState(false)

  // Share a product
  const [shareProduct, setShareProduct] = useState<CommerceProduct | null>(null)
  const [sharePhone, setSharePhone] = useState('')
  const [shareType, setShareType] = useState<'single_product' | 'website_redirect'>('single_product')
  const [isSharing, setIsSharing] = useState(false)

  // Settings
  const [settingsForm, setSettingsForm] = useState({
    meta_catalog_id: '',
    commerce_payment_gateway: 'razorpay',
    commerce_gateway_config_name: '',
    commerce_enable_cod: true,
    commerce_default_shipping_fee: '0',
    commerce_free_shipping_threshold: '0',
    commerce_address_flow_id: '',
  })
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [detected, setDetected] = useState<{ catalogs: any[]; paymentConfigs: any[]; flows: any[] } | null>(null)
  const [isDetecting, setIsDetecting] = useState(false)
  const [isDeployingFlow, setIsDeployingFlow] = useState(false)
  const [isEnablingCart, setIsEnablingCart] = useState(false)

  const showToast = useCallback((kind: 'success' | 'error', text: string) => setToast({ kind, text }), [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.kind === 'error' ? 7000 : 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const currency = String(orgData?.currency || 'INR').toUpperCase()

  // ── Loading ────────────────────────────────────────────────────────────────
  const fetchOrders = useCallback(async (organizationId: string) => {
    const res = await fetch(`/api/commerce/orders?organizationId=${organizationId}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Orders could not be loaded')
    setOrders(data.orders || [])
  }, [])

  const fetchProducts = useCallback(async (organizationId: string) => {
    const res = await fetch(`/api/commerce/products?organizationId=${organizationId}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Products could not be loaded')
    setProducts(data.products || [])
  }, [])

  useEffect(() => {
    async function load() {
      try {
        await restoreSupabaseSession()
        const user = authSessionManager.getUser()
        if (!user?.id) return

        const { data: profile } = await supabase.from('users').select('organization_id').eq('id', user.id).maybeSingle()
        if (!profile?.organization_id) return
        const organizationId = profile.organization_id
        setOrgId(organizationId)

        const { data: org } = await supabase.from('organizations').select('*').eq('id', organizationId).single()
        if (org) {
          setOrgData(org)
          setSettingsForm({
            meta_catalog_id: org.meta_catalog_id || '',
            commerce_payment_gateway: (SUPPORTED_PAYMENT_GATEWAYS as readonly string[]).includes(org.commerce_payment_gateway) ? org.commerce_payment_gateway : 'razorpay',
            commerce_gateway_config_name: org.commerce_gateway_config_name || '',
            commerce_enable_cod: org.commerce_enable_cod !== false,
            commerce_default_shipping_fee: String(org.commerce_default_shipping_fee ?? '0'),
            commerce_free_shipping_threshold: String(org.commerce_free_shipping_threshold ?? '0'),
            commerce_address_flow_id: org.commerce_address_flow_id || '',
          })
          setNewProduct((current) => ({ ...current, currency: String(org.currency || 'INR').toUpperCase() }))
        }

        await Promise.all([fetchOrders(organizationId), fetchProducts(organizationId)])
      } catch (err: any) {
        setLoadError(err.message || 'The store could not be loaded. Refresh the page to try again.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [fetchOrders, fetchProducts])

  // Esc closes whichever overlay is open
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSelectedOrderId(null)
      setShareProduct(null)
      setShowAddProduct(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── Derived data ───────────────────────────────────────────────────────────
  const setup = useMemo(() => getCommerceSetup(orgData), [orgData])
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) || null

  const filteredOrders = useMemo(() => {
    const filter = ORDER_FILTERS.find((item) => item.id === orderFilter) || ORDER_FILTERS[0]
    const term = orderSearch.trim().toLowerCase()
    return orders.filter((order) => {
      if (!filter.matches(order.status)) return false
      if (!term) return true
      return (
        order.order_number.toLowerCase().includes(term) ||
        customerName(order).toLowerCase().includes(term) ||
        (order.contact?.phone_number || '').replace(/\s/g, '').includes(term.replace(/\s/g, ''))
      )
    })
  }, [orders, orderFilter, orderSearch])

  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase()
    return term ? products.filter((product) => product.title.toLowerCase().includes(term) || product.retailer_id.toLowerCase().includes(term)) : products
  }, [products, productSearch])

  // Revenue is totalled per currency: adding rupees to dollars would be meaningless
  const revenue = useMemo(() => {
    const totals = new Map<string, number>()
    for (const order of orders) {
      if (!isRevenueOrder(order)) continue
      const code = String(order.currency || currency).toUpperCase()
      totals.set(code, (totals.get(code) || 0) + Number(order.total_amount || 0))
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1])
  }, [orders, currency])

  const awaitingCount = orders.filter((order) => OPEN_CHECKOUT_STATUSES.includes(order.status)).length
  const toShipCount = orders.filter((order) => order.status === 'paid' || order.status === 'cod_confirmed').length

  // ── Orders ─────────────────────────────────────────────────────────────────
  const openOrder = (order: CommerceOrder) => {
    setSelectedOrderId(order.id)
    setNotifyCustomer(true)
    setTrackingNumber('')
  }

  async function updateOrderStatus(order: CommerceOrder, status: OrderStatus) {
    if (!orgId) return
    if (status === 'canceled') {
      const confirmed = await confirm({
        title: `Cancel order #${order.order_number}?`,
        message: order.payment_status === 'paid' ? 'This order is already paid. Canceling it here does not refund the customer; refund them through your payment provider.' : 'A canceled order cannot be reopened.',
        confirmLabel: 'Cancel order',
        cancelLabel: 'Keep order',
        destructive: true,
      })
      if (!confirmed) return
    }

    setUpdatingStatus(status)
    try {
      const res = await fetch('/api/commerce/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, organizationId: orgId, status, notifyCustomer, trackingNumber: status === 'shipped' ? trackingNumber : undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The order could not be updated')

      setOrders((current) => current.map((item) => (item.id === order.id ? { ...item, ...data.order } : item)))
      setTrackingNumber('')
      const label = ORDER_STATUS_LABELS[status]
      if (!notifyCustomer) showToast('success', `Order #${order.order_number} is now “${label}”.`)
      else if (data.notified) showToast('success', `Order #${order.order_number} is now “${label}”. The customer was notified on WhatsApp.`)
      else showToast('error', `Order #${order.order_number} is now “${label}”, but the customer was not notified: ${data.notifyError || 'WhatsApp did not accept the message'}`)
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setUpdatingStatus(null)
    }
  }

  // ── Products ───────────────────────────────────────────────────────────────
  async function syncCatalog() {
    if (!orgId) return
    setIsSyncing(true)
    try {
      const res = await fetch('/api/commerce/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, action: 'sync_meta' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The catalog could not be synced')
      await fetchProducts(orgId)
      showToast(data.synced === data.total ? 'success' : 'error', `Synced ${data.synced || 0} of ${data.total || 0} products from your Meta catalog.`)
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setIsSyncing(false)
    }
  }

  async function createProduct(event: React.FormEvent) {
    event.preventDefault()
    if (!orgId) return
    setProductError('')
    setIsSavingProduct(true)
    try {
      const res = await fetch('/api/commerce/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, product: newProduct }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The product could not be saved')
      setShowAddProduct(false)
      setNewProduct({ ...EMPTY_PRODUCT, currency })
      await fetchProducts(orgId)
      showToast('success', `“${data.product?.title || 'Product'}” was saved.`)
    } catch (err: any) {
      setProductError(err.message)
    } finally {
      setIsSavingProduct(false)
    }
  }

  async function deleteProduct(product: CommerceProduct) {
    if (!orgId) return
    const confirmed = await confirm({
      title: 'Remove this product?',
      message: `“${product.title}” will be removed from this list. It is not deleted from your Meta catalog, and a catalog sync will bring it back.`,
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!confirmed) return
    try {
      const res = await fetch(`/api/commerce/products?organizationId=${orgId}&id=${product.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The product could not be removed')
      setProducts((current) => current.filter((item) => item.id !== product.id))
    } catch (err: any) {
      showToast('error', err.message)
    }
  }

  const openShare = (product: CommerceProduct) => {
    setShareProduct(product)
    setSharePhone('')
    // Start on a format that can actually be sent for this product
    setShareType(setup.catalogLinked ? 'single_product' : 'website_redirect')
  }

  async function sendProduct(event: React.FormEvent) {
    event.preventDefault()
    if (!orgId || !shareProduct) return
    setIsSharing(true)
    try {
      const res = await fetch('/api/commerce/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: orgId,
          phone: sharePhone.trim(),
          type: shareType,
          payload: {
            productRetailerId: shareProduct.retailer_id,
            productTitle: shareProduct.title,
            bodyText: `Check out ${shareProduct.title} for ${formatMoney(shareProduct.price, shareProduct.currency)}:`,
            websiteUrl: shareProduct.website_url || undefined,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The message could not be sent')
      setShareProduct(null)
      showToast('success', `“${shareProduct.title}” was sent to ${sharePhone.trim()}.`)
    } catch (err: any) {
      alert({ title: 'Message not sent', message: err.message })
    } finally {
      setIsSharing(false)
    }
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  async function detectFromMeta() {
    if (!orgId) return
    setIsDetecting(true)
    try {
      const res = await fetch(`/api/commerce/meta-detect?organizationId=${orgId}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Meta could not be reached')
      setDetected({ catalogs: data.catalogs || [], paymentConfigs: data.paymentConfigs || [], flows: data.flows || [] })
      showToast('success', `Found ${data.catalogs?.length || 0} catalog(s), ${data.paymentConfigs?.length || 0} payment setup(s) and ${data.flows?.length || 0} form(s). Pick them from the lists below.`)
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setIsDetecting(false)
    }
  }

  async function deployAddressFlow() {
    if (!orgId) return
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
      setSettingsForm((current) => ({ ...current, commerce_address_flow_id: data.flowId }))
      setOrgData((current) => (current ? { ...current, commerce_address_flow_id: data.flowId } : current))
      showToast('success', 'The delivery address form is published and will be sent after each order.')
    } catch (err: any) {
      alert({ title: 'Address form not published', message: err.message })
    } finally {
      setIsDeployingFlow(false)
    }
  }

  async function enableCart() {
    if (!orgId) return
    setIsEnablingCart(true)
    try {
      const res = await fetch('/api/commerce/meta-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, action: 'enable_cart' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The cart could not be enabled')
      showToast('success', 'Cart and catalog are now visible on your WhatsApp number.')
    } catch (err: any) {
      alert({ title: 'Cart not enabled', message: err.message })
    } finally {
      setIsEnablingCart(false)
    }
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault()
    if (!orgId) return
    const shippingFee = Number(settingsForm.commerce_default_shipping_fee)
    const freeAbove = Number(settingsForm.commerce_free_shipping_threshold)
    if (!Number.isFinite(shippingFee) || shippingFee < 0 || !Number.isFinite(freeAbove) || freeAbove < 0) {
      showToast('error', 'Shipping amounts must be 0 or more.')
      return
    }

    setIsSavingSettings(true)
    try {
      const update = {
        meta_catalog_id: settingsForm.meta_catalog_id.trim() || null,
        commerce_payment_gateway: settingsForm.commerce_payment_gateway,
        commerce_gateway_config_name: settingsForm.commerce_gateway_config_name.trim() || null,
        commerce_enable_cod: settingsForm.commerce_enable_cod,
        commerce_default_shipping_fee: shippingFee,
        commerce_free_shipping_threshold: freeAbove,
        commerce_address_flow_id: settingsForm.commerce_address_flow_id.trim() || null,
        enable_commerce: true,
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase.from('organizations').update(update).eq('id', orgId)
      if (error) throw error
      setOrgData((current) => (current ? { ...current, ...update } : current))
      showToast('success', 'Store settings saved.')
    } catch (err: any) {
      alert({ title: 'Settings not saved', message: err.message })
    } finally {
      setIsSavingSettings(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-[#0b141a]">
        <div className="flex items-center gap-2.5 text-sm font-medium text-slate-600 dark:text-slate-300">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
          Loading your store…
        </div>
      </div>
    )
  }

  const setupSteps = [
    { done: setup.whatsappConnected, label: 'Connect WhatsApp', detail: 'Needed to receive orders and message customers.', action: <Link href="/dashboard/settings" className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">Open Settings</Link> },
    { done: setup.catalogLinked, label: 'Link your Meta catalog', detail: 'Lets you send product cards customers can add to a cart.', action: null },
    { done: setup.paymentGateway || setup.cashOnDelivery, label: 'Choose how customers pay', detail: 'An in-chat payment gateway, Cash on Delivery, or both.', action: null },
    { done: setup.addressFlow, label: 'Collect delivery addresses (optional)', detail: 'Sends an address form after each order.', action: null },
  ]
  const setupComplete = setup.whatsappConnected && setup.catalogLinked && setup.canCheckout

  const tabs: Array<{ id: Tab; label: string; icon: typeof Package; count?: number }> = [
    { id: 'orders', label: 'Orders', icon: Package, count: orders.length },
    { id: 'products', label: 'Products', icon: ShoppingBag, count: products.length },
    { id: 'settings', label: 'Store settings', icon: Settings },
  ]

  return (
    // The dashboard shell does not scroll; each page scrolls itself
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-[#0b141a] text-slate-900 dark:text-slate-100">
      <div className="max-w-7xl mx-auto p-4 pb-24 md:p-8 md:pb-10 space-y-5">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 shrink-0 rounded-2xl bg-gradient-to-tr from-[#008069] to-[#00a884] flex items-center justify-center text-white shadow-sm">
              <ShoppingBag size={20} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Commerce</h1>
              <p className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400">Sell from your WhatsApp catalog: orders, payments and delivery in one place.</p>
            </div>
          </div>

          <div role="tablist" aria-label="Commerce sections" className="inline-flex max-w-full overflow-x-auto no-scrollbar gap-1 p-1 rounded-xl bg-white dark:bg-[#111b21] border border-slate-200 dark:border-slate-800 shadow-[0_1px_2px_rgba(11,20,26,0.05)]">
            {tabs.map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setActiveTab(id)}
                className={`shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  activeTab === id ? 'bg-[#008069] text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon size={14} />
                {label}
                {count !== undefined && <span className={`tabular-nums font-semibold ${activeTab === id ? 'text-white/80' : 'text-slate-400'}`}>{count}</span>}
              </button>
            ))}
          </div>
        </div>

        {loadError && (
          <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs font-medium text-rose-700 dark:text-rose-200 flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            {loadError}
          </div>
        )}

        {/* Setup checklist: shown until the store can take an order end to end */}
        {!setupComplete && orgData && (
          <div className={`${cardClass} p-4 sm:p-5`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Finish setting up your store</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Customers can order once the first three steps are done.</p>
              </div>
              {activeTab !== 'settings' && (
                <button type="button" onClick={() => setActiveTab('settings')} className={secondaryButton}>
                  <Settings size={14} /> Open store settings
                </button>
              )}
            </div>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {setupSteps.map((step) => (
                <li key={step.label} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60">
                  {step.done ? <CheckCircle2 size={18} className="shrink-0 mt-px text-emerald-500" /> : <Circle size={18} className="shrink-0 mt-px text-slate-300 dark:text-slate-600" />}
                  <div className="min-w-0 text-xs">
                    <p className={`font-semibold ${step.done ? 'text-slate-500 dark:text-slate-400 line-through decoration-slate-300' : 'text-slate-900 dark:text-white'}`}>{step.label}</p>
                    {!step.done && (
                      <p className="text-slate-500 dark:text-slate-400">
                        {step.detail} {step.action}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <Metric
            label="Revenue received"
            value={revenue.length ? formatMoney(revenue[0][1], revenue[0][0]) : formatMoney(0, currency)}
            note={revenue.length > 1 ? `Also ${revenue.slice(1).map(([code, total]) => formatMoney(total, code)).join(', ')}` : 'Paid orders, excluding canceled'}
            icon={Wallet}
            tone="text-emerald-500"
          />
          <Metric label="Orders" value={String(orders.length)} note="Carts received on WhatsApp" icon={Package} tone="text-blue-500" />
          <Metric label="Awaiting customer" value={String(awaitingCount)} note="Address or payment not completed" icon={Clock} tone="text-amber-500" />
          <Metric label="To ship" value={String(toShipCount)} note="Paid or COD confirmed" icon={Truck} tone="text-violet-500" />
        </div>

        {/* ── Orders ── */}
        {activeTab === 'orders' && (
          <div className="space-y-3">
            <div className={`${cardClass} p-3 flex flex-col md:flex-row md:items-center justify-between gap-3`}>
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                {ORDER_FILTERS.map((filter) => {
                  const count = orders.filter((order) => filter.matches(order.status)).length
                  const active = orderFilter === filter.id
                  return (
                    <button
                      key={filter.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setOrderFilter(filter.id)}
                      className={`shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                        active ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {filter.label}
                      <span className="tabular-nums text-slate-400">{count}</span>
                    </button>
                  )
                })}
              </div>
              <div className="relative w-full md:w-64 shrink-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                <input type="search" aria-label="Search orders" placeholder="Search order, name or phone" value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} className={`${inputClass} pl-9`} />
              </div>
            </div>

            {filteredOrders.length === 0 ? (
              <div className={`${cardClass} py-14 px-6 text-center`}>
                <Package size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
                <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{orders.length === 0 ? 'No orders yet' : 'No orders match this view'}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                  {orders.length === 0 ? 'When a customer sends a cart from your WhatsApp catalog, the order appears here automatically.' : 'Try a different filter or search term.'}
                </p>
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
                      {filteredOrders.map((order) => (
                        <tr
                          key={order.id}
                          tabIndex={0}
                          onClick={() => openOrder(order)}
                          onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), openOrder(order))}
                          className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900 dark:text-white">#{order.order_number}</div>
                            <div className="text-[11px] text-slate-400">{new Date(order.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900 dark:text-white">{customerName(order)}</div>
                            <div className="text-[11px] text-slate-500">{order.contact?.phone_number}</div>
                          </td>
                          <td className="py-3 px-4 max-w-[220px]">
                            <div className="truncate text-slate-700 dark:text-slate-300">{order.items?.map((item) => `${item.quantity} × ${item.title}`).join(', ') || '—'}</div>
                          </td>
                          <td className="py-3 px-4">
                            <StatusBadge status={order.status} />
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-white tabular-nums">{formatMoney(order.total_amount, order.currency)}</td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400 max-w-[180px]">
                            {order.shipping_address?.address_line_1 ? (
                              <span className="flex items-center gap-1">
                                <MapPin size={12} className="text-emerald-500 shrink-0" />
                                <span className="truncate">{[order.shipping_address.city, order.shipping_address.pincode].filter(Boolean).join(', ')}</span>
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
                  {filteredOrders.map((order) => (
                    <button key={order.id} type="button" onClick={() => openOrder(order)} className={`${cardClass} w-full text-left p-3.5 cursor-pointer`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-slate-900 dark:text-white">#{order.order_number}</div>
                          <div className="text-xs text-slate-500 truncate">{customerName(order)}</div>
                        </div>
                        <StatusBadge status={order.status} />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="text-slate-500 truncate pr-3">{order.items?.map((item) => `${item.quantity} × ${item.title}`).join(', ') || '—'}</span>
                        <span className="font-bold text-slate-900 dark:text-white tabular-nums shrink-0">{formatMoney(order.total_amount, order.currency)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Products ── */}
        {activeTab === 'products' && (
          <div className="space-y-3">
            <div className={`${cardClass} p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                <input type="search" aria-label="Search products" placeholder="Search by name or SKU" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} className={`${inputClass} pl-9`} />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={syncCatalog} disabled={isSyncing || !setup.catalogLinked} title={setup.catalogLinked ? 'Copy products from your Meta catalog' : 'Link a Meta catalog in Store settings first'} className={secondaryButton}>
                  <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
                  {isSyncing ? 'Syncing…' : 'Sync from Meta'}
                </button>
                <button type="button" onClick={() => { setProductError(''); setShowAddProduct(true) }} className={primaryButton}>
                  <Plus size={14} /> Add product
                </button>
              </div>
            </div>

            {filteredProducts.length === 0 ? (
              <div className={`${cardClass} py-14 px-6 text-center`}>
                <ShoppingBag size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
                <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{products.length === 0 ? 'No products yet' : 'No products match your search'}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                  {products.length === 0 ? 'Sync your Meta catalog to list what customers can buy on WhatsApp, or add a product to share as a website link.' : 'Try a different name or SKU.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredProducts.map((product) => {
                  const inStock = product.is_available && (product.inventory_count ?? 1) > 0
                  return (
                    <div key={product.id} className={`${cardClass} overflow-hidden flex flex-col`}>
                      <div className="relative h-40 bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                        {product.image_url ? (
                          // Catalog images live on arbitrary CDNs, so a plain img is used rather than next/image
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={product.image_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                        ) : (
                          <ShoppingBag size={36} className="text-slate-300 dark:text-slate-600" />
                        )}
                        {!inStock && <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-900/80 text-white">Out of stock</span>}
                      </div>
                      <div className="p-3.5 flex-1 flex flex-col gap-2.5">
                        <div className="min-w-0">
                          <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">{product.title}</h3>
                          <p className="text-[11px] text-slate-500 truncate">SKU {product.retailer_id}</p>
                          {product.description && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{product.description}</p>}
                        </div>
                        <div className="mt-auto pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                          <span className="font-bold text-base text-slate-900 dark:text-white tabular-nums">{formatMoney(product.price, product.currency)}</span>
                          <div className="flex items-center gap-1">
                            <button type="button" aria-label={`Remove ${product.title}`} title="Remove" onClick={() => deleteProduct(product)} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer">
                              <Trash2 size={14} />
                            </button>
                            <button type="button" onClick={() => openShare(product)} className={`${primaryButton} h-8 px-3`}>
                              <Send size={12} /> Share
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Store settings ── */}
        {activeTab === 'settings' && (
          <form onSubmit={saveSettings} className="max-w-3xl space-y-4">
            <div className={`${cardClass} p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Fill in from Meta</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Looks up the catalogs, payment setups and forms on your WhatsApp Business account so you can pick them below.</p>
              </div>
              <button type="button" onClick={detectFromMeta} disabled={isDetecting || !setup.whatsappConnected} title={setup.whatsappConnected ? undefined : 'Connect WhatsApp in Settings first'} className={secondaryButton}>
                {isDetecting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {isDetecting ? 'Looking…' : 'Detect from Meta'}
              </button>
            </div>

            <section className={`${cardClass} p-4 sm:p-5 space-y-4`}>
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Catalog</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">The Meta catalog whose products customers can add to a WhatsApp cart.</p>
              </div>
              <div>
                <label htmlFor="catalog-id" className={labelClass}>Meta catalog ID</label>
                {detected && detected.catalogs.length > 0 && (
                  <select aria-label="Detected catalogs" value="" onChange={(event) => event.target.value && setSettingsForm({ ...settingsForm, meta_catalog_id: event.target.value })} className={`${inputClass} mb-2`}>
                    <option value="">Choose a detected catalog…</option>
                    {detected.catalogs.map((catalog) => (
                      <option key={catalog.id} value={catalog.id}>
                        {catalog.name || 'Catalog'} · {catalog.product_count || 0} products
                      </option>
                    ))}
                  </select>
                )}
                <input id="catalog-id" type="text" inputMode="numeric" placeholder="e.g. 102938475610293" value={settingsForm.meta_catalog_id} onChange={(event) => setSettingsForm({ ...settingsForm, meta_catalog_id: event.target.value })} className={inputClass} />
                <p className={hintClass}>Found in Meta Business Suite → Commerce Manager → Catalogs.</p>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60">
                <p className="text-xs text-slate-600 dark:text-slate-300">Show the cart and catalog buttons on your WhatsApp number.</p>
                <button type="button" onClick={enableCart} disabled={isEnablingCart || !setup.whatsappConnected} className={secondaryButton}>
                  {isEnablingCart ? <Loader2 size={13} className="animate-spin" /> : <ShoppingBag size={13} />}
                  {isEnablingCart ? 'Enabling…' : 'Enable cart'}
                </button>
              </div>
            </section>

            <section className={`${cardClass} p-4 sm:p-5 space-y-4`}>
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Delivery address</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Optional. When set, customers get an address form right after they send a cart.</p>
              </div>
              <div>
                <label htmlFor="address-flow" className={labelClass}>Address form (Meta Flow ID)</label>
                {detected && detected.flows.length > 0 && (
                  <select aria-label="Detected forms" value="" onChange={(event) => event.target.value && setSettingsForm({ ...settingsForm, commerce_address_flow_id: event.target.value })} className={`${inputClass} mb-2`}>
                    <option value="">Choose one of your Meta forms…</option>
                    {detected.flows.map((flow) => (
                      <option key={flow.id} value={flow.id} disabled={flow.status !== 'PUBLISHED'}>
                        {flow.name} · {flow.status === 'PUBLISHED' ? 'published' : 'not published'}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input id="address-flow" type="text" inputMode="numeric" placeholder="Leave empty to skip the address step" value={settingsForm.commerce_address_flow_id} onChange={(event) => setSettingsForm({ ...settingsForm, commerce_address_flow_id: event.target.value })} className={inputClass} />
                  <button type="button" onClick={deployAddressFlow} disabled={isDeployingFlow || !setup.whatsappConnected} className={`${secondaryButton} shrink-0`}>
                    {isDeployingFlow ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    {isDeployingFlow ? 'Publishing…' : 'Create the standard form'}
                  </button>
                </div>
                <p className={hintClass}>“Create the standard form” publishes a ready-made address form to your WhatsApp account and saves its ID here. A custom form must start on a screen named SHIPPING_DETAILS.</p>
              </div>
            </section>

            <section className={`${cardClass} p-4 sm:p-5 space-y-4`}>
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Payment</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">If an in-chat payment gateway is set up, customers are asked to pay through it. Otherwise they are offered Cash on Delivery when it is allowed.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="gateway" className={labelClass}>Payment gateway</label>
                  <select id="gateway" value={settingsForm.commerce_payment_gateway} onChange={(event) => setSettingsForm({ ...settingsForm, commerce_payment_gateway: event.target.value })} className={inputClass}>
                    {SUPPORTED_PAYMENT_GATEWAYS.map((gateway) => (
                      <option key={gateway} value={gateway}>
                        {GATEWAY_LABELS[gateway]}
                      </option>
                    ))}
                  </select>
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
                        setSettingsForm({
                          ...settingsForm,
                          commerce_gateway_config_name: found.configuration_name,
                          commerce_payment_gateway: (SUPPORTED_PAYMENT_GATEWAYS as readonly string[]).includes(gateway) ? gateway : settingsForm.commerce_payment_gateway,
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
                  <input id="gateway-config" type="text" placeholder="Leave empty if you only take COD" value={settingsForm.commerce_gateway_config_name} onChange={(event) => setSettingsForm({ ...settingsForm, commerce_gateway_config_name: event.target.value })} className={inputClass} />
                  <p className={hintClass}>The name you gave the payment setup in WhatsApp Manager → Payments.</p>
                </div>
              </div>
              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 cursor-pointer">
                <input type="checkbox" checked={settingsForm.commerce_enable_cod} onChange={(event) => setSettingsForm({ ...settingsForm, commerce_enable_cod: event.target.checked })} className="mt-0.5 h-4 w-4 rounded accent-[#00a884]" />
                <span className="text-xs">
                  <span className="block font-semibold text-slate-900 dark:text-white">Allow Cash on Delivery</span>
                  <span className="block text-slate-500 dark:text-slate-400">Customers confirm the order with one tap and pay when it arrives.</span>
                </span>
              </label>
              {!settingsForm.commerce_gateway_config_name.trim() && !settingsForm.commerce_enable_cod && (
                <p role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-200">
                  <AlertCircle size={15} className="shrink-0 mt-px" />
                  With no gateway and no Cash on Delivery, customers can place an order but cannot pay in the chat. They will only be told that your team will contact them.
                </p>
              )}
            </section>

            <section className={`${cardClass} p-4 sm:p-5 space-y-4`}>
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Shipping</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Amounts are in {currency}, your workspace currency.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="shipping-fee" className={labelClass}>Shipping fee</label>
                  <input id="shipping-fee" type="number" min={0} step="0.01" value={settingsForm.commerce_default_shipping_fee} onChange={(event) => setSettingsForm({ ...settingsForm, commerce_default_shipping_fee: event.target.value })} className={inputClass} />
                  <p className={hintClass}>Added to every order. Express delivery adds a further {formatMoney(50, currency)}.</p>
                </div>
                <div>
                  <label htmlFor="free-shipping" className={labelClass}>Free shipping on orders from</label>
                  <input id="free-shipping" type="number" min={0} step="0.01" value={settingsForm.commerce_free_shipping_threshold} onChange={(event) => setSettingsForm({ ...settingsForm, commerce_free_shipping_threshold: event.target.value })} className={inputClass} />
                  <p className={hintClass}>Use 0 to always charge the shipping fee.</p>
                </div>
              </div>
            </section>

            <div className="flex justify-end">
              <button type="submit" disabled={isSavingSettings} className={primaryButton}>
                {isSavingSettings ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
                {isSavingSettings ? 'Saving…' : 'Save store settings'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ── Order details ── */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Order ${selectedOrder.order_number}`}>
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={() => setSelectedOrderId(null)} />
          <div className="absolute inset-y-0 right-0 w-full max-w-md bg-white dark:bg-[#111b21] border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">Order #{selectedOrder.order_number}</h3>
                  <StatusBadge status={selectedOrder.status} />
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{new Date(selectedOrder.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
              </div>
              <button type="button" aria-label="Close order" onClick={() => setSelectedOrderId(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Customer */}
              <section>
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Customer</h4>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-slate-900 dark:text-white truncate">{customerName(selectedOrder)}</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      <Phone size={11} /> {selectedOrder.contact?.phone_number || 'No phone number'}
                    </p>
                  </div>
                  {selectedOrder.conversation_id && (
                    <Link href={`/dashboard?conversationId=${selectedOrder.conversation_id}`} className={`${secondaryButton} h-8 px-3`}>
                      <MessageCircle size={13} /> Open chat
                    </Link>
                  )}
                </div>
                {selectedOrder.customer_note && <p className="mt-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 text-xs text-slate-600 dark:text-slate-300">“{selectedOrder.customer_note}”</p>}
              </section>

              {/* Items and totals */}
              <section>
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Items</h4>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {(selectedOrder.items || []).map((item) => (
                    <li key={item.id} className="py-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 dark:text-white truncate">{item.title}</p>
                        <p className="text-xs text-slate-500">
                          {item.quantity} × {formatMoney(item.unit_price, selectedOrder.currency)} · SKU {item.retailer_id}
                        </p>
                      </div>
                      <span className="font-semibold text-slate-900 dark:text-white tabular-nums shrink-0">{formatMoney(item.total_price, selectedOrder.currency)}</span>
                    </li>
                  ))}
                  {(selectedOrder.items || []).length === 0 && <li className="py-2 text-xs text-slate-500">No item details were recorded for this order.</li>}
                </ul>
                <dl className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs space-y-1">
                  <div className="flex justify-between text-slate-600 dark:text-slate-400"><dt>Subtotal</dt><dd className="tabular-nums">{formatMoney(selectedOrder.subtotal, selectedOrder.currency)}</dd></div>
                  <div className="flex justify-between text-slate-600 dark:text-slate-400"><dt>Shipping</dt><dd className="tabular-nums">{Number(selectedOrder.shipping_fee) ? formatMoney(selectedOrder.shipping_fee, selectedOrder.currency) : 'Free'}</dd></div>
                  {Number(selectedOrder.tax_amount) > 0 && (
                    <div className="flex justify-between text-slate-600 dark:text-slate-400"><dt>Tax</dt><dd className="tabular-nums">{formatMoney(selectedOrder.tax_amount, selectedOrder.currency)}</dd></div>
                  )}
                  <div className="flex justify-between pt-1 text-sm font-bold text-slate-900 dark:text-white"><dt>Total</dt><dd className="tabular-nums">{formatMoney(selectedOrder.total_amount, selectedOrder.currency)}</dd></div>
                </dl>
              </section>

              {/* Payment */}
              <section>
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Payment</h4>
                <p className="text-sm text-slate-900 dark:text-white">
                  <span className={`font-semibold ${selectedOrder.payment_status === 'paid' ? 'text-emerald-600 dark:text-emerald-400' : selectedOrder.payment_status === 'failed' ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                    {selectedOrder.payment_status === 'paid' ? 'Paid' : selectedOrder.payment_status === 'failed' ? 'Payment failed' : selectedOrder.payment_status === 'refunded' ? 'Refunded' : 'Not paid yet'}
                  </span>
                  {selectedOrder.payment_method && (
                    <span className="text-slate-500"> · {selectedOrder.payment_method === 'cod' ? 'Cash on Delivery' : selectedOrder.payment_method === 'whatsapp_pay' ? 'Paid in WhatsApp' : 'Payment link'}</span>
                  )}
                </p>
                {selectedOrder.meta_payment_reference && <p className="text-[11px] text-slate-500 font-mono break-all">Ref {selectedOrder.meta_payment_reference}</p>}
              </section>

              {/* Delivery */}
              <section>
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Deliver to</h4>
                {selectedOrder.shipping_address?.address_line_1 ? (
                  <address className="not-italic p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                    <p className="font-semibold text-slate-900 dark:text-white">{selectedOrder.shipping_address.full_name}</p>
                    <p>{selectedOrder.shipping_address.address_line_1}</p>
                    {selectedOrder.shipping_address.address_line_2 && <p>{selectedOrder.shipping_address.address_line_2}</p>}
                    <p>{[selectedOrder.shipping_address.city, selectedOrder.shipping_address.state, selectedOrder.shipping_address.pincode].filter(Boolean).join(', ')}</p>
                    {selectedOrder.shipping_address.phone_number && <p>{selectedOrder.shipping_address.phone_number}</p>}
                    <p className="mt-1 text-slate-500 capitalize">{selectedOrder.shipping_address.delivery_speed || 'standard'} delivery</p>
                    {selectedOrder.shipping_address.notes && <p className="mt-1 text-slate-500">Note: {selectedOrder.shipping_address.notes}</p>}
                  </address>
                ) : (
                  <p className="text-xs text-slate-500">The customer has not given a delivery address yet.</p>
                )}
              </section>
            </div>

            {/* Actions: only the moves that make sense from the current status */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-[#0c1317] space-y-3">
              {getNextOrderStatuses(selectedOrder.status).length === 0 ? (
                <p className="text-xs text-center text-slate-500">This order is {ORDER_STATUS_LABELS[selectedOrder.status].toLowerCase()}. No further steps.</p>
              ) : (
                <>
                  {getNextOrderStatuses(selectedOrder.status).includes('shipped') && (
                    <div>
                      <label htmlFor="tracking" className={labelClass}>Tracking number (optional)</label>
                      <input id="tracking" type="text" maxLength={80} value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} placeholder="Included in the shipping message" className={inputClass} />
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={notifyCustomer} onChange={(event) => setNotifyCustomer(event.target.checked)} className="h-4 w-4 rounded accent-[#00a884]" />
                    Tell the customer on WhatsApp
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {getNextOrderStatuses(selectedOrder.status).map((status) => (
                      <button
                        key={status}
                        type="button"
                        disabled={updatingStatus !== null}
                        onClick={() => updateOrderStatus(selectedOrder, status)}
                        className={status === 'canceled' ? `${secondaryButton} text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30` : `${primaryButton} flex-1`}
                      >
                        {updatingStatus === status && <Loader2 size={13} className="animate-spin" />}
                        {ACTION_LABELS[status] || ORDER_STATUS_LABELS[status]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Share a product ── */}
      {shareProduct && (
        <Modal title="Send product on WhatsApp" onClose={() => setShareProduct(null)}>
          <form onSubmit={sendProduct} className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 flex items-center gap-3">
              {shareProduct.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shareProduct.image_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
              ) : (
                <div className="w-12 h-12 shrink-0 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-400">
                  <ShoppingBag size={20} />
                </div>
              )}
              <div className="min-w-0">
                <p className="font-bold text-sm text-slate-900 dark:text-white truncate">{shareProduct.title}</p>
                <p className="text-xs text-slate-500">{formatMoney(shareProduct.price, shareProduct.currency)} · SKU {shareProduct.retailer_id}</p>
              </div>
            </div>

            <div>
              <label htmlFor="share-phone" className={labelClass}>Customer&apos;s WhatsApp number</label>
              <input id="share-phone" type="tel" required autoFocus pattern="[+0-9 \(\)\-]{8,20}" title="Include the country code, e.g. +91 98765 43210" placeholder="+91 98765 43210" value={sharePhone} onChange={(event) => setSharePhone(event.target.value)} className={inputClass} />
              <p className={hintClass}>Include the country code. WhatsApp only delivers this if the customer messaged you in the last 24 hours.</p>
            </div>

            <fieldset>
              <legend className={labelClass}>Send as</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { id: 'single_product' as const, title: 'Catalog card', detail: 'Customer can add it to a cart in WhatsApp', disabledReason: setup.catalogLinked ? '' : 'Link a Meta catalog in Store settings' },
                  { id: 'website_redirect' as const, title: 'Website link', detail: 'Opens the product page on your site', disabledReason: shareProduct.website_url ? '' : 'This product has no website link' },
                ].map((option) => (
                  <label
                    key={option.id}
                    className={`p-3 rounded-xl border text-xs transition-colors ${option.disabledReason ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${
                      shareType === option.id && !option.disabledReason ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <input type="radio" name="share-type" className="sr-only" disabled={Boolean(option.disabledReason)} checked={shareType === option.id} onChange={() => setShareType(option.id)} />
                    <span className="block font-bold text-slate-900 dark:text-white">{option.title}</span>
                    <span className="block mt-0.5 text-slate-500 dark:text-slate-400">{option.disabledReason || option.detail}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShareProduct(null)} className={secondaryButton}>Cancel</button>
              <button type="submit" disabled={isSharing || (shareType === 'single_product' ? !setup.catalogLinked : !shareProduct.website_url)} className={primaryButton}>
                {isSharing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {isSharing ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Add a product ── */}
      {showAddProduct && (
        <Modal title="Add product" onClose={() => setShowAddProduct(false)} wide>
          <form onSubmit={createProduct} className="space-y-3.5">
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Products added here are saved in this CRM only. To sell one from the WhatsApp cart, add it to your Meta catalog with the same SKU.
            </p>
            {productError && (
              <p role="alert" className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-200">
                <AlertCircle size={14} className="shrink-0 mt-px" /> {productError}
              </p>
            )}
            <div>
              <label htmlFor="product-title" className={labelClass}>Name</label>
              <input id="product-title" type="text" required maxLength={150} autoFocus placeholder="Classic white linen shirt" value={newProduct.title} onChange={(event) => setNewProduct({ ...newProduct, title: event.target.value })} className={inputClass} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="col-span-2">
                <label htmlFor="product-sku" className={labelClass}>SKU</label>
                <input id="product-sku" type="text" required maxLength={100} placeholder="SHIRT-001" value={newProduct.retailer_id} onChange={(event) => setNewProduct({ ...newProduct, retailer_id: event.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="product-price" className={labelClass}>Price</label>
                <input id="product-price" type="number" required min={0} step="0.01" placeholder="1499" value={newProduct.price} onChange={(event) => setNewProduct({ ...newProduct, price: event.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="product-currency" className={labelClass}>Currency</label>
                <select id="product-currency" value={newProduct.currency} onChange={(event) => setNewProduct({ ...newProduct, currency: event.target.value })} className={inputClass}>
                  {[...new Set([currency, 'INR', 'USD', 'EUR', 'GBP'])].map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="product-category" className={labelClass}>Category (optional)</label>
                <input id="product-category" type="text" maxLength={60} placeholder="Shirts" value={newProduct.category} onChange={(event) => setNewProduct({ ...newProduct, category: event.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="product-stock" className={labelClass}>In stock (optional)</label>
                <input id="product-stock" type="number" min={0} step={1} placeholder="Not tracked" value={newProduct.inventory_count} onChange={(event) => setNewProduct({ ...newProduct, inventory_count: event.target.value })} className={inputClass} />
              </div>
            </div>
            <div>
              <label htmlFor="product-description" className={labelClass}>Description (optional)</label>
              <textarea id="product-description" rows={2} maxLength={2000} value={newProduct.description} onChange={(event) => setNewProduct({ ...newProduct, description: event.target.value })} className={`${inputClass} resize-y`} />
            </div>
            <div>
              <label htmlFor="product-image" className={labelClass}>Image link (optional)</label>
              <input id="product-image" type="url" placeholder="https://…" value={newProduct.image_url} onChange={(event) => setNewProduct({ ...newProduct, image_url: event.target.value })} className={inputClass} />
            </div>
            <div>
              <label htmlFor="product-url" className={labelClass}>Product page on your website (optional)</label>
              <input id="product-url" type="url" placeholder="https://yourstore.com/products/…" value={newProduct.website_url} onChange={(event) => setNewProduct({ ...newProduct, website_url: event.target.value })} className={inputClass} />
              <p className={hintClass}>Needed to share this product as a website link.</p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowAddProduct(false)} className={secondaryButton}>Cancel</button>
              <button type="submit" disabled={isSavingProduct} className={primaryButton}>
                {isSavingProduct && <Loader2 size={13} className="animate-spin" />}
                {isSavingProduct ? 'Saving…' : 'Save product'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Result of the last action */}
      {toast && (
        <div
          role={toast.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-md flex items-start gap-2.5 px-4 py-3 rounded-xl shadow-2xl text-xs font-medium ${
            toast.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
          }`}
        >
          {toast.kind === 'error' ? <AlertCircle size={16} className="shrink-0 mt-px" /> : <CheckCircle2 size={16} className="shrink-0 mt-px text-emerald-400 dark:text-emerald-600" />}
          <span className="flex-1 leading-relaxed">{toast.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)} className="p-0.5 rounded hover:bg-white/15 dark:hover:bg-slate-900/10 cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

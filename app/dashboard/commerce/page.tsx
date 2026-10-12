'use client'

import { useState, useEffect } from 'react'
import {
  ShoppingBag,
  Package,
  CreditCard,
  Settings,
  RefreshCw,
  Plus,
  Send,
  ExternalLink,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  Truck,
  MapPin,
  ChevronRight,
  Filter,
  DollarSign,
  ArrowUpRight,
  ShieldCheck,
  Check,
  X,
  Phone,
  Sparkles,
} from 'lucide-react'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { useAlert } from '@/lib/dialog-context'
import { authSessionManager } from '@/lib/auth-context'
import { CommerceOrder, CommerceProduct } from '@/lib/types'

export default function CommercePage() {
  const alert = useAlert()
  const [activeTab, setActiveTab] = useState<'orders' | 'products' | 'settings'>('orders')
  const [loading, setLoading] = useState(true)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgData, setOrgData] = useState<any>(null)

  // Orders State
  const [orders, setOrders] = useState<CommerceOrder[]>([])
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all')
  const [orderSearch, setOrderSearch] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<CommerceOrder | null>(null)
  const [isUpdatingOrder, setIsUpdatingOrder] = useState(false)

  // Products State
  const [products, setProducts] = useState<CommerceProduct[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [isSyncingMeta, setIsSyncingMeta] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [showAddProductModal, setShowAddProductModal] = useState(false)
  const [newProduct, setNewProduct] = useState({
    title: '',
    retailer_id: '',
    price: '',
    currency: 'INR',
    description: '',
    image_url: '',
    website_url: '',
    category: 'General',
  })

  // Share to Contact Modal State
  const [shareProduct, setShareProduct] = useState<CommerceProduct | null>(null)
  const [sharePhone, setSharePhone] = useState('')
  const [shareType, setShareType] = useState<'single_product' | 'website_redirect'>('single_product')
  const [isSendingProduct, setIsSendingProduct] = useState(false)
  const [shareSuccess, setShareSuccess] = useState(false)

  // Settings State
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
  const [settingsSuccess, setSettingsSuccess] = useState(false)

  // Auto-detection state
  const [detectedCatalogs, setDetectedCatalogs] = useState<any[]>([])
  const [detectedPaymentConfigs, setDetectedPaymentConfigs] = useState<any[]>([])
  const [detectedFlows, setDetectedFlows] = useState<any[]>([])
  const [isDetectingMeta, setIsDetectingMeta] = useState(false)
  const [isDeployingFlow, setIsDeployingFlow] = useState(false)
  const [isEnablingCart, setIsEnablingCart] = useState(false)
  const [detectNotice, setDetectNotice] = useState<string | null>(null)

  // 1. Initial Load
  useEffect(() => {
    async function loadData() {
      setLoading(true)
      await restoreSupabaseSession()
      const user = authSessionManager.getUser()
      if (!user?.id) {
        setLoading(false)
        return
      }

      const { data: profile } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle()

      if (!profile?.organization_id) {
        setLoading(false)
        return
      }

      const organizationId = profile.organization_id
      setOrgId(organizationId)

      // Fetch org settings
      const { data: org } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', organizationId)
        .single()

      if (org) {
        setOrgData(org)
        setSettingsForm({
          meta_catalog_id: org.meta_catalog_id || '',
          commerce_payment_gateway: org.commerce_payment_gateway || 'razorpay',
          commerce_gateway_config_name: org.commerce_gateway_config_name || '',
          commerce_enable_cod: org.commerce_enable_cod !== false,
          commerce_default_shipping_fee: String(org.commerce_default_shipping_fee || '0'),
          commerce_free_shipping_threshold: String(org.commerce_free_shipping_threshold || '0'),
          commerce_address_flow_id: org.commerce_address_flow_id || '',
        })
      }

      await Promise.all([fetchOrders(organizationId), fetchProducts(organizationId)])
      setLoading(false)
    }

    loadData()
  }, [])

  // 2. Fetch Orders
  async function fetchOrders(organizationId: string) {
    try {
      const res = await fetch(`/api/commerce/orders?organizationId=${organizationId}`)
      const data = await res.json()
      if (data.orders) setOrders(data.orders)
    } catch (err) {
      console.error('Failed to fetch orders:', err)
    }
  }

  // 3. Fetch Products
  async function fetchProducts(organizationId: string) {
    try {
      const res = await fetch(`/api/commerce/products?organizationId=${organizationId}`)
      const data = await res.json()
      if (data.products) setProducts(data.products)
    } catch (err) {
      console.error('Failed to fetch products:', err)
    }
  }

  // 4. Update Order Status
  async function handleUpdateOrderStatus(
    orderId: string,
    newStatus: string,
    notify: boolean = true
  ) {
    if (!orgId) return
    setIsUpdatingOrder(true)
    try {
      const res = await fetch('/api/commerce/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          organizationId: orgId,
          status: newStatus,
          paymentStatus: newStatus === 'paid' ? 'paid' : undefined,
          notifyCustomer: notify,
        }),
      })

      if (res.ok) {
        await fetchOrders(orgId)
        if (selectedOrder?.id === orderId) {
          setSelectedOrder((prev) => (prev ? { ...prev, status: newStatus as any } : null))
        }
      }
    } catch (err) {
      console.error('Failed to update order:', err)
    } finally {
      setIsUpdatingOrder(false)
    }
  }

  // 5. Sync Products with Meta Catalog
  async function handleSyncMeta() {
    if (!orgId) return
    setIsSyncingMeta(true)
    setSyncMessage(null)
    try {
      const res = await fetch('/api/commerce/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, action: 'sync_meta' }),
      })
      const data = await res.json()
      if (res.ok) {
        setSyncMessage(`Successfully synced ${data.synced || 0} products from Meta Catalog!`)
        await fetchProducts(orgId)
      } else {
        setSyncMessage(`Sync failed: ${data.error || 'Check catalog credentials'}`)
      }
    } catch (err: any) {
      setSyncMessage(`Sync error: ${err.message}`)
    } finally {
      setIsSyncingMeta(false)
    }
  }

  // 6. Create Product Manually
  async function handleCreateProduct(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId) return
    try {
      const res = await fetch('/api/commerce/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, product: newProduct }),
      })
      if (res.ok) {
        setShowAddProductModal(false)
        setNewProduct({
          title: '',
          retailer_id: '',
          price: '',
          currency: 'INR',
          description: '',
          image_url: '',
          website_url: '',
          category: 'General',
        })
        await fetchProducts(orgId)
      }
    } catch (err) {
      console.error('Failed to create product:', err)
    }
  }

  // 7. Send Product / Catalog to WhatsApp Contact
  async function handleSendProductToContact(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId || !shareProduct || !sharePhone) return
    setIsSendingProduct(true)
    setShareSuccess(false)

    try {
      const payload: any = {
        productRetailerId: shareProduct.retailer_id,
        bodyText: `Check out our ${shareProduct.title} for ${shareProduct.currency} ${shareProduct.price}:`,
      }

      if (shareType === 'website_redirect') {
        payload.websiteUrl = shareProduct.website_url || 'https://yourstore.com'
        payload.productTitle = shareProduct.title
      }

      const res = await fetch('/api/commerce/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: orgId,
          phone: sharePhone,
          type: shareType,
          payload,
        }),
      })

      if (res.ok) {
        setShareSuccess(true)
        setTimeout(() => {
          setShareProduct(null)
          setSharePhone('')
          setShareSuccess(false)
        }, 1500)
      } else {
        const errData = await res.json()
        alert({ title: 'Message not sent', message: errData.error || 'Failed to send message' })
      }
    } catch (err: any) {
      alert({ title: 'Message not sent', message: err.message })
    } finally {
      setIsSendingProduct(false)
    }
  }

  // Auto-Detect connected Catalogs, Payment Gateways & Flows from Meta
  async function handleAutoDetect() {
    if (!orgId) return
    setIsDetectingMeta(true)
    setDetectNotice(null)
    try {
      const res = await fetch(`/api/commerce/meta-detect?organizationId=${orgId}`)
      const data = await res.json()
      if (res.ok) {
        setDetectedCatalogs(data.catalogs || [])
        setDetectedPaymentConfigs(data.paymentConfigs || [])
        setDetectedFlows(data.flows || [])
        setDetectNotice(
          `Detected ${data.catalogs?.length || 0} catalog(s), ${data.paymentConfigs?.length || 0} payment gateway(s), and ${data.flows?.length || 0} flow(s) from Meta!`
        )
      } else {
        setDetectNotice(`Detection notice: ${data.error || 'Check WABA credentials'}`)
      }
    } catch (err: any) {
      setDetectNotice(`Detection error: ${err.message}`)
    } finally {
      setIsDetectingMeta(false)
    }
  }

  // 1-Click Deploy Delivery Address Flow directly to Meta
  async function handleDeployAddressFlow() {
    if (!orgId) return
    setIsDeployingFlow(true)
    try {
      const res = await fetch('/api/commerce/meta-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, action: 'deploy_address_flow' }),
      })
      const data = await res.json()
      if (res.ok && data.flowId) {
        setSettingsForm((prev) => ({ ...prev, commerce_address_flow_id: data.flowId }))
        alert({ title: 'Address flow deployed', message: `The Delivery Address Flow is published on Meta (Flow ID: ${data.flowId}).` })
      } else {
        alert({ title: 'Flow not deployed', message: data.error || 'Unknown error' })
      }
    } catch (err: any) {
      alert({ title: 'Flow not deployed', message: err.message })
    } finally {
      setIsDeployingFlow(false)
    }
  }

  // 1-Click Enable Native Cart & Storefront on Meta
  async function handleEnableNativeCart() {
    if (!orgId) return
    setIsEnablingCart(true)
    try {
      const res = await fetch('/api/commerce/meta-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId, action: 'enable_cart' }),
      })
      const data = await res.json()
      if (res.ok) {
        alert({ title: 'Cart enabled', message: 'Native Cart and Catalog storefront visibility are now enabled on your WhatsApp phone number.' })
      } else {
        alert({ title: 'Cart not enabled', message: data.error || 'Unknown error' })
      }
    } catch (err: any) {
      alert({ title: 'Cart not enabled', message: err.message })
    } finally {
      setIsEnablingCart(false)
    }
  }

  // 8. Save Commerce Settings
  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId) return
    setIsSavingSettings(true)
    setSettingsSuccess(false)

    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          meta_catalog_id: settingsForm.meta_catalog_id.trim() || null,
          commerce_payment_gateway: settingsForm.commerce_payment_gateway,
          commerce_gateway_config_name: settingsForm.commerce_gateway_config_name.trim() || null,
          commerce_enable_cod: settingsForm.commerce_enable_cod,
          commerce_default_shipping_fee: parseFloat(settingsForm.commerce_default_shipping_fee) || 0,
          commerce_free_shipping_threshold:
            parseFloat(settingsForm.commerce_free_shipping_threshold) || 0,
          commerce_address_flow_id: settingsForm.commerce_address_flow_id.trim() || null,
          enable_commerce: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', orgId)

      if (error) throw error
      setSettingsSuccess(true)
      setTimeout(() => setSettingsSuccess(false), 2500)
    } catch (err: any) {
      alert({ title: 'Settings not saved', message: err.message })
    } finally {
      setIsSavingSettings(false)
    }
  }

  // Filtered Lists
  const filteredOrders = orders.filter((o) => {
    const matchesStatus = orderStatusFilter === 'all' || o.status === orderStatusFilter
    const matchesSearch =
      !orderSearch ||
      o.order_number.toLowerCase().includes(orderSearch.toLowerCase()) ||
      (o.contact?.first_name || '').toLowerCase().includes(orderSearch.toLowerCase()) ||
      (o.contact?.phone_number || '').includes(orderSearch)
    return matchesStatus && matchesSearch
  })

  const filteredProducts = products.filter(
    (p) =>
      !productSearch ||
      p.title.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.retailer_id.toLowerCase().includes(productSearch.toLowerCase())
  )

  // Metrics
  const totalRevenue = orders
    .filter((o) => o.status === 'paid' || o.status === 'delivered')
    .reduce((sum, o) => sum + Number(o.total_amount), 0)

  const pendingOrdersCount = orders.filter(
    (o) => o.status === 'cart_submitted' || o.status === 'awaiting_address' || o.status === 'payment_pending'
  ).length

  return (
    <div className="flex-1 p-6 md:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-sm">
              <ShoppingBag size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                WhatsApp Commerce
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Native WhatsApp Catalog, In-Chat Checkout & Website Redirection
              </p>
            </div>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200/60 dark:border-slate-700/60 shadow-2xs">
          <button
            onClick={() => setActiveTab('orders')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'orders'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Package size={15} />
            Orders ({orders.length})
          </button>
          <button
            onClick={() => setActiveTab('products')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'products'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ShoppingBag size={15} />
            Catalog & Products ({products.length})
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'settings'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Settings size={15} />
            Commerce Settings
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
            <span>WhatsApp Revenue</span>
            <DollarSign size={16} className="text-emerald-500" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white mt-2">
            ₹{totalRevenue.toLocaleString()}
          </div>
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
            In-chat authorized sales
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
            <span>Total Orders</span>
            <Package size={16} className="text-blue-500" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white mt-2">
            {orders.length}
          </div>
          <span className="text-[11px] text-slate-500">Native carts received</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
            <span>Pending Checkout</span>
            <Clock size={16} className="text-amber-500" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400 mt-2">
            {pendingOrdersCount}
          </div>
          <span className="text-[11px] text-slate-500">Awaiting address/payment</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
            <span>Catalog Items</span>
            <ShoppingBag size={16} className="text-purple-500" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white mt-2">
            {products.length}
          </div>
          <span className="text-[11px] text-purple-600 dark:text-purple-400 font-medium">
            Live in Meta WhatsApp Shop
          </span>
        </div>
      </div>

      {/* TAB 1: ORDERS DASHBOARD */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          {/* Filters & Search */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1 mr-1">
                <Filter size={13} /> Status:
              </span>
              {[
                { id: 'all', label: 'All Orders' },
                { id: 'awaiting_address', label: 'Awaiting Address' },
                { id: 'payment_pending', label: 'Payment Pending' },
                { id: 'paid', label: 'Paid' },
                { id: 'cod_confirmed', label: 'COD' },
                { id: 'shipped', label: 'Shipped' },
                { id: 'delivered', label: 'Delivered' },
              ].map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => setOrderStatusFilter(filter.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    orderStatusFilter === filter.id
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/30'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
              <input
                type="text"
                placeholder="Search order # or phone..."
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Orders Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 border-b border-slate-200/80 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Order</th>
                    <th className="py-3 px-4 font-semibold">Customer</th>
                    <th className="py-3 px-4 font-semibold">Items</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold">Total</th>
                    <th className="py-3 px-4 font-semibold">Shipping Address</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-slate-400">
                        No WhatsApp orders found matching current filter.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => (
                      <tr key={order.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                          #{order.order_number}
                          <div className="text-[10px] font-normal text-slate-400">
                            {new Date(order.created_at).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-slate-900 dark:text-white">
                            {order.contact?.first_name || 'Customer'}
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1">
                            <Phone size={10} />
                            {order.contact?.phone_number}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {order.items?.length || 1} item(s)
                          </span>
                          <div className="text-[10px] text-slate-400 truncate max-w-[150px]">
                            {order.items?.map((it) => it.title).join(', ') || 'Catalog product'}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              order.status === 'paid'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : order.status === 'shipped'
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                                : order.status === 'delivered'
                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                                : order.status === 'cod_confirmed'
                                ? 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            }`}
                          >
                            {order.status === 'paid' && <CheckCircle2 size={11} />}
                            {order.status === 'shipped' && <Truck size={11} />}
                            {order.status === 'delivered' && <Check size={11} />}
                            {order.status.replace('_', ' ').toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                          ₹{Number(order.total_amount).toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400 max-w-[180px] truncate">
                          {order.shipping_address?.address_line_1 ? (
                            <span className="flex items-center gap-1">
                              <MapPin size={12} className="text-emerald-500 shrink-0" />
                              <span className="truncate">
                                {order.shipping_address.city}, {order.shipping_address.pincode}
                              </span>
                            </span>
                          ) : (
                            <span className="text-amber-500 text-[11px] italic">Awaiting flow</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => setSelectedOrder(order)}
                            className="px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg transition-colors cursor-pointer"
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PRODUCTS & CATALOG */}
      {activeTab === 'products' && (
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs">
            <div className="flex items-center gap-2 flex-1">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
                <input
                  type="text"
                  placeholder="Search products by title or SKU..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {syncMessage && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  {syncMessage}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleSyncMeta}
                disabled={isSyncingMeta}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-all cursor-pointer"
              >
                <RefreshCw size={13} className={isSyncingMeta ? 'animate-spin' : ''} />
                Sync Meta Catalog
              </button>
              <button
                onClick={() => setShowAddProductModal(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-all cursor-pointer"
              >
                <Plus size={14} />
                Add Product
              </button>
            </div>
          </div>

          {/* Products Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredProducts.length === 0 ? (
              <div className="col-span-full py-16 text-center text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800">
                <ShoppingBag size={32} className="mx-auto mb-2 opacity-50" />
                <p>No products in catalog yet.</p>
                <p className="text-xs mt-1">
                  Click "Sync Meta Catalog" or "Add Product" to populate your digital store.
                </p>
              </div>
            ) : (
              filteredProducts.map((p) => (
                <div
                  key={p.id}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs overflow-hidden flex flex-col group hover:border-emerald-500/50 transition-all"
                >
                  <div className="h-40 bg-slate-100 dark:bg-slate-800 relative overflow-hidden flex items-center justify-center">
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt={p.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <ShoppingBag size={40} className="text-slate-300 dark:text-slate-600" />
                    )}
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/90 dark:bg-slate-900/90 text-slate-700 dark:text-slate-300 backdrop-blur-xs">
                      SKU: {p.retailer_id}
                    </span>
                  </div>

                  <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white line-clamp-1">
                        {p.title}
                      </h3>
                      <p className="text-xs text-slate-500 line-clamp-2 mt-1">
                        {p.description || 'No description provided.'}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-slate-400 block font-medium">Price</span>
                        <span className="font-bold text-base text-slate-900 dark:text-white">
                          ₹{Number(p.price).toLocaleString()}
                        </span>
                      </div>

                      <button
                        onClick={() => {
                          setShareProduct(p)
                          setSharePhone('')
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all shadow-xs cursor-pointer"
                      >
                        <Send size={12} />
                        Share
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: COMMERCE SETTINGS */}
      {activeTab === 'settings' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs p-6 max-w-3xl space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <ShoppingBag size={20} className="text-emerald-500" />
                WhatsApp Commerce Configuration
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Auto-detect or configure Meta Catalog ID, In-Chat Payment Gateways, and shipping rules.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleAutoDetect}
                disabled={isDetectingMeta}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 rounded-xl border border-emerald-300/40 transition-all cursor-pointer shadow-2xs"
              >
                <Sparkles size={13} className={isDetectingMeta ? 'animate-spin' : ''} />
                {isDetectingMeta ? 'Detecting...' : 'Auto-Detect from Meta'}
              </button>
              <button
                type="button"
                onClick={handleEnableNativeCart}
                disabled={isEnablingCart}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-xl transition-all cursor-pointer"
              >
                <ShoppingBag size={13} />
                {isEnablingCart ? 'Enabling...' : 'Enable Cart in WhatsApp'}
              </button>
            </div>
          </div>

          {detectNotice && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 font-medium">
              {detectNotice}
            </div>
          )}

          <div className="space-y-5">
            {/* Meta Catalog ID */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Meta Catalog ID
                </label>
                {detectedCatalogs.length > 0 && (
                  <span className="text-[11px] text-emerald-600 font-semibold">
                    {detectedCatalogs.length} catalog(s) detected
                  </span>
                )}
              </div>

              {detectedCatalogs.length > 0 && (
                <select
                  onChange={(e) => {
                    if (e.target.value) setSettingsForm({ ...settingsForm, meta_catalog_id: e.target.value })
                  }}
                  className="w-full mb-2 px-3 py-2 text-xs rounded-xl bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-300/60 dark:border-emerald-800 text-slate-900 dark:text-white font-medium focus:outline-hidden"
                >
                  <option value="">⚡ Select detected catalog from Meta...</option>
                  {detectedCatalogs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || 'Catalog'} (ID: {c.id}) - {c.product_count || 0} products
                    </option>
                  ))}
                </select>
              )}

              <input
                type="text"
                placeholder="e.g. 102938475610293"
                value={settingsForm.meta_catalog_id}
                onChange={(e) => setSettingsForm({ ...settingsForm, meta_catalog_id: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Auto-detected from Meta, or found in Meta Business Suite &gt; Commerce Manager &gt; Catalogs.
              </p>
            </div>

            {/* In-Chat Payment Gateway */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                  Supported In-Chat Payment Partner
                </label>
                <select
                  value={settingsForm.commerce_payment_gateway}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, commerce_payment_gateway: e.target.value })
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="razorpay">Razorpay (India - UPI & Cards)</option>
                  <option value="payu">PayU (India)</option>
                  <option value="cashfree">Cashfree (India)</option>
                  <option value="link">Payment Link / UPI Intent</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    Meta Gateway Config Name
                  </label>
                  {detectedPaymentConfigs.length > 0 && (
                    <span className="text-[11px] text-emerald-600 font-semibold">
                      {detectedPaymentConfigs.length} gateway(s) detected
                    </span>
                  )}
                </div>

                {detectedPaymentConfigs.length > 0 && (
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        const found = detectedPaymentConfigs.find(
                          (p) => p.configuration_name === e.target.value
                        )
                        setSettingsForm({
                          ...settingsForm,
                          commerce_gateway_config_name: e.target.value,
                          commerce_payment_gateway: found?.payment_gateway || 'razorpay',
                        })
                      }
                    }}
                    className="w-full mb-2 px-3 py-2 text-xs rounded-xl bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-300/60 dark:border-emerald-800 text-slate-900 dark:text-white font-medium focus:outline-hidden"
                  >
                    <option value="">⚡ Select detected gateway configuration...</option>
                    {detectedPaymentConfigs.map((p) => (
                      <option key={p.configuration_name} value={p.configuration_name}>
                        {(p.payment_gateway || 'GATEWAY').toUpperCase()} - {p.configuration_name} ({p.status || 'active'})
                      </option>
                    ))}
                  </select>
                )}

                <input
                  type="text"
                  placeholder="e.g. razorpay_waba_config"
                  value={settingsForm.commerce_gateway_config_name}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, commerce_gateway_config_name: e.target.value })
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Auto-detected or configured in WhatsApp Manager &gt; Payments.
                </p>
              </div>
            </div>

            {/* Address Collection Flow */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  WhatsApp Delivery Address Flow
                </label>
                <button
                  type="button"
                  onClick={handleDeployAddressFlow}
                  disabled={isDeployingFlow}
                  className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles size={12} />
                  {isDeployingFlow ? 'Deploying to Meta...' : '⚡ 1-Click Deploy & Publish Flow'}
                </button>
              </div>

              {detectedFlows.length > 0 && (
                <select
                  onChange={(e) => {
                    if (e.target.value) setSettingsForm({ ...settingsForm, commerce_address_flow_id: e.target.value })
                  }}
                  className="w-full mb-2 px-3 py-2 text-xs rounded-xl bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-300/60 dark:border-emerald-800 text-slate-900 dark:text-white font-medium focus:outline-hidden"
                >
                  <option value="">⚡ Select from your Meta Flows...</option>
                  {detectedFlows.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} (ID: {f.id}) - {f.status}
                    </option>
                  ))}
                </select>
              )}

              <input
                type="text"
                placeholder="Meta Flow ID for Delivery Address Form"
                value={settingsForm.commerce_address_flow_id}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, commerce_address_flow_id: e.target.value })
                }
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Click "1-Click Deploy" above to automatically create and publish this flow on Meta with zero manual entry!
              </p>
            </div>

            {/* Shipping Fees */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                  Default Shipping Fee (₹)
                </label>
                <input
                  type="number"
                  value={settingsForm.commerce_default_shipping_fee}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, commerce_default_shipping_fee: e.target.value })
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                  Free Shipping Above (₹)
                </label>
                <input
                  type="number"
                  value={settingsForm.commerce_free_shipping_threshold}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, commerce_free_shipping_threshold: e.target.value })
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* Cash on Delivery Toggle */}
            <div className="flex items-center gap-3 pt-2">
              <input
                type="checkbox"
                id="cod_toggle"
                checked={settingsForm.commerce_enable_cod}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, commerce_enable_cod: e.target.checked })
                }
                className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 dark:border-slate-700"
              />
              <label htmlFor="cod_toggle" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Allow Cash on Delivery (COD) confirmation in WhatsApp chat
              </label>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            {settingsSuccess && (
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <Check size={14} /> Settings saved successfully!
              </span>
            )}
            <div className="ml-auto">
              <button
                type="submit"
                disabled={isSavingSettings}
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all shadow-xs cursor-pointer"
              >
                {isSavingSettings ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* MODAL: SHARE PRODUCT / SHOWCASE TO CONTACT */}
      {shareProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Send size={15} className="text-emerald-500" />
                Share Product to WhatsApp
              </h3>
              <button
                onClick={() => setShareProduct(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl flex items-center gap-3">
              {shareProduct.image_url ? (
                <img
                  src={shareProduct.image_url}
                  alt={shareProduct.title}
                  className="w-12 h-12 rounded-lg object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                  <ShoppingBag size={20} />
                </div>
              )}
              <div>
                <h4 className="font-bold text-xs text-slate-900 dark:text-white line-clamp-1">
                  {shareProduct.title}
                </h4>
                <p className="text-[11px] text-slate-500">
                  ₹{Number(shareProduct.price).toLocaleString()} • SKU: {shareProduct.retailer_id}
                </p>
              </div>
            </div>

            <form onSubmit={handleSendProductToContact} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                  Recipient WhatsApp Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. +91 9876543210"
                  required
                  value={sharePhone}
                  onChange={(e) => setSharePhone(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                  Dispatch Format
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setShareType('single_product')}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                      shareType === 'single_product'
                        ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <div className="font-bold">Native SPM</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Meta in-chat cart view</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShareType('website_redirect')}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                      shareType === 'website_redirect'
                        ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <div className="font-bold">Website CTA</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Deep-link with UTM tracking</div>
                  </button>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                {shareSuccess && (
                  <span className="text-xs text-emerald-600 font-bold flex items-center gap-1">
                    <Check size={14} /> Message dispatched!
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShareProduct(null)}
                    className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSendingProduct}
                    className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all cursor-pointer"
                  >
                    {isSendingProduct ? 'Sending...' : 'Send to Customer'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ORDER DETAILS & LIFECYCLE MANAGEMENT */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                  Order #{selectedOrder.order_number}
                </h3>
                <span className="text-xs text-slate-400">
                  Customer: {selectedOrder.contact?.first_name || 'Customer'} (
                  {selectedOrder.contact?.phone_number})
                </span>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Line items list */}
            <div className="space-y-2 border-y border-slate-100 dark:border-slate-800 py-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Purchased Items
              </span>
              {(selectedOrder.items || []).map((it) => (
                <div key={it.id} className="flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {it.title}
                    </span>
                    <span className="text-slate-400 ml-1.5">x {it.quantity}</span>
                  </div>
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    ₹{Number(it.total_price).toLocaleString()}
                  </span>
                </div>
              ))}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-xs font-bold text-slate-900 dark:text-white">
                <span>Total Amount:</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  ₹{Number(selectedOrder.total_amount).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Shipping Address */}
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Delivery Address
              </span>
              {selectedOrder.shipping_address?.address_line_1 ? (
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl text-xs space-y-0.5 text-slate-700 dark:text-slate-300">
                  <p className="font-bold">{selectedOrder.shipping_address.full_name}</p>
                  <p>{selectedOrder.shipping_address.address_line_1}</p>
                  {selectedOrder.shipping_address.address_line_2 && (
                    <p>{selectedOrder.shipping_address.address_line_2}</p>
                  )}
                  <p>
                    {selectedOrder.shipping_address.city}, {selectedOrder.shipping_address.state} -{' '}
                    {selectedOrder.shipping_address.pincode}
                  </p>
                  <p className="text-slate-400 text-[11px] pt-1">
                    Speed: {selectedOrder.shipping_address.delivery_speed || 'Standard'}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-amber-500 italic">No delivery address submitted yet.</p>
              )}
            </div>

            {/* Quick Status Update Buttons */}
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
                Update Order Status & Notify Customer
              </span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={isUpdatingOrder}
                  onClick={() => handleUpdateOrderStatus(selectedOrder.id, 'paid')}
                  className="px-2.5 py-2 text-xs font-bold rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 transition-colors cursor-pointer border border-emerald-300/40"
                >
                  Mark as Paid
                </button>
                <button
                  type="button"
                  disabled={isUpdatingOrder}
                  onClick={() => handleUpdateOrderStatus(selectedOrder.id, 'shipped')}
                  className="px-2.5 py-2 text-xs font-bold rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 transition-colors cursor-pointer border border-blue-300/40"
                >
                  Mark Shipped
                </button>
                <button
                  type="button"
                  disabled={isUpdatingOrder}
                  onClick={() => handleUpdateOrderStatus(selectedOrder.id, 'delivered')}
                  className="px-2.5 py-2 text-xs font-bold rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 hover:bg-purple-100 transition-colors cursor-pointer border border-purple-300/40"
                >
                  Mark Delivered
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD PRODUCT MANUALLY */}
      {showAddProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Add Catalog Product
              </h3>
              <button
                onClick={() => setShowAddProductModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Product Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Classic White Linen Shirt"
                  value={newProduct.title}
                  onChange={(e) => setNewProduct({ ...newProduct, title: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    SKU / Retailer ID
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. SHIRT-001"
                    value={newProduct.retailer_id}
                    onChange={(e) => setNewProduct({ ...newProduct, retailer_id: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Price (₹)
                  </label>
                  <input
                    type="number"
                    required
                    placeholder="e.g. 1499"
                    value={newProduct.price}
                    onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Image URL
                </label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={newProduct.image_url}
                  onChange={(e) => setNewProduct({ ...newProduct, image_url: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Website Product Page URL (for Redirection)
                </label>
                <input
                  type="url"
                  placeholder="https://yourstore.com/products/..."
                  value={newProduct.website_url}
                  onChange={(e) => setNewProduct({ ...newProduct, website_url: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddProductModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all cursor-pointer"
                >
                  Save Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

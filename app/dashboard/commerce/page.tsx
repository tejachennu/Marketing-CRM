'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, CheckCircle2, Circle, Clock, Loader2, Package, PauseCircle, Settings, ShoppingBag, Truck, Wallet, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { can, type RoleSubject } from '@/lib/rbac'
import type { CommerceSummary } from '@/lib/commerce/commerce-stats'
import { formatMoney, getCommerceSetup } from '@/lib/commerce/commerce-utils'
import { OrdersTab } from '@/components/commerce/orders-tab'
import { ProductsTab } from '@/components/commerce/products-tab'
import { StoreSettings } from '@/components/commerce/store-settings'
import { Metric, cardClass, secondaryButton } from '@/components/commerce/ui'

type Tab = 'orders' | 'products' | 'settings'

export default function CommercePage() {
  const [activeTab, setActiveTab] = useState<Tab>('orders')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgData, setOrgData] = useState<Record<string, any> | null>(null)
  const [viewer, setViewer] = useState<RoleSubject>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  // Totals for the whole store; the tabs report them as they load
  const [summary, setSummary] = useState<CommerceSummary | null>(null)
  const [productCount, setProductCount] = useState<number | null>(null)

  const showToast = useCallback((kind: 'success' | 'error', text: string) => setToast({ kind, text }), [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.kind === 'error' ? 8000 : 4000)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    async function load() {
      try {
        await restoreSupabaseSession()
        const user = authSessionManager.getUser()
        if (!user?.id) return

        const { data: profile } = await supabase.from('users').select('organization_id, role, see_all, read_only').eq('id', user.id).maybeSingle()
        if (!profile?.organization_id) return
        const organizationId = profile.organization_id
        setViewer({ id: user.id, role: profile.role, see_all: profile.see_all, read_only: profile.read_only })

        // The API returns the store without its API credentials
        const orgRes = await fetch(`/api/organization?organizationId=${organizationId}`)
        const orgBody = await orgRes.json().catch(() => ({}))
        if (!orgRes.ok) throw new Error(orgBody.error || 'The store could not be loaded. Refresh the page to try again.')
        setOrgData(orgBody.organization || {})
        setOrgId(organizationId)

        // The Products tab shows its count before it is opened
        fetch(`/api/commerce/products?organizationId=${organizationId}&limit=1`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.pagination) setProductCount(data.pagination.total)
          })
          .catch(() => {})
      } catch (err: any) {
        setLoadError(err.message || 'The store could not be loaded. Refresh the page to try again.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const setup = useMemo(() => getCommerceSetup(orgData), [orgData])
  const currency = String(orgData?.currency || 'INR').toUpperCase()

  // Everyone sees orders and products; changing the catalog or the store setup is for admins and managers
  const canManageStore = can(viewer, 'automation.manage')
  const canEdit = can(viewer, 'records.write')

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50 dark:bg-[#0b141a]">
        <div className="flex items-center gap-2.5 text-sm font-medium text-slate-600 dark:text-slate-300">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
          Loading your store…
        </div>
      </div>
    )
  }

  const setupSteps = [
    { done: setup.whatsappConnected, label: 'Connect WhatsApp', detail: 'Needed to receive orders and message customers.', action: <Link href="/dashboard/settings" className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">Open Settings</Link> },
    { done: setup.catalogLinked, label: 'Link your Meta catalog', detail: 'Lets customers add products to a cart in WhatsApp.', action: null },
    { done: setup.paymentGateway || setup.cashOnDelivery, label: 'Choose how customers pay', detail: 'An in-chat payment gateway, Cash on Delivery, or both.', action: null },
    { done: setup.addressFlow, label: 'Collect delivery addresses (optional)', detail: 'Sends an address form after each order.', action: null },
  ]
  const setupComplete = setup.whatsappConnected && setup.catalogLinked && setup.canCheckout
  // Set up, but switched off: carts are silently ignored, which looks exactly like "no orders"
  const storeOff = orgData?.enable_commerce === false && (setup.catalogLinked || setup.paymentGateway || setup.addressFlow)

  const tabs: Array<{ id: Tab; label: string; icon: LucideIcon; count?: number | null }> = [
    { id: 'orders', label: 'Orders', icon: Package, count: summary?.total },
    { id: 'products', label: 'Products', icon: ShoppingBag, count: productCount },
    ...(canManageStore ? [{ id: 'settings' as Tab, label: 'Store settings', icon: Settings }] : []),
  ]

  const revenue = summary?.revenue || []

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
                {typeof count === 'number' && <span className={`tabular-nums font-semibold ${activeTab === id ? 'text-white/80' : 'text-slate-400'}`}>{count.toLocaleString()}</span>}
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

        {storeOff && (
          <div role="alert" className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <p className="flex items-start gap-2 text-[13px] text-amber-900 dark:text-amber-200">
              <PauseCircle size={16} className="shrink-0 mt-0.5" />
              <span><strong className="font-semibold">Your store is switched off.</strong> Carts that customers send on WhatsApp are not turned into orders.</span>
            </p>
            {canManageStore && activeTab !== 'settings' && (
              <button type="button" onClick={() => setActiveTab('settings')} className={`${secondaryButton} shrink-0`}>
                <Settings size={14} /> Open store settings
              </button>
            )}
          </div>
        )}

        {/* Setup checklist: shown until the store can take an order end to end */}
        {!setupComplete && orgData && (
          <div className={`${cardClass} p-4 sm:p-5`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Finish setting up your store</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Customers can order once the first three steps are done.{!canManageStore && ' An admin or manager can complete them.'}
                </p>
              </div>
              {activeTab !== 'settings' && canManageStore && (
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

        {/* Totals for the whole store, whatever the list below is filtered to */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <Metric
            label="Revenue received"
            value={summary ? formatMoney(revenue[0]?.amount || 0, revenue[0]?.currency || currency) : '—'}
            note={revenue.length > 1 ? `Also ${revenue.slice(1).map((item) => formatMoney(item.amount, item.currency)).join(', ')}` : 'Paid orders, excluding canceled'}
            icon={Wallet}
            tone="text-emerald-500"
          />
          <Metric label="Orders" value={summary ? summary.total.toLocaleString() : '—'} note="Carts received on WhatsApp" icon={Package} tone="text-blue-500" />
          <Metric label="Awaiting customer" value={summary ? summary.awaiting.toLocaleString() : '—'} note="Address or payment not completed" icon={Clock} tone="text-amber-500" />
          <Metric
            label="To ship"
            value={summary ? summary.toShip.toLocaleString() : '—'}
            note={summary && summary.refundDue > 0 ? `${summary.refundDue} canceled after payment: refund due` : 'Paid or COD confirmed'}
            icon={Truck}
            tone="text-violet-500"
          />
        </div>

        {orgId && activeTab === 'orders' && (
          <OrdersTab orgId={orgId} canEdit={canEdit} collectsAddress={setup.addressFlow} summary={summary} onSummary={setSummary} showToast={showToast} />
        )}

        {orgId && activeTab === 'products' && (
          <ProductsTab orgId={orgId} currency={currency} canEdit={canEdit} canManageStore={canManageStore} catalogLinked={setup.catalogLinked && setup.whatsappConnected} onCount={setProductCount} showToast={showToast} />
        )}

        {orgId && orgData && activeTab === 'settings' && canManageStore && (
          <StoreSettings
            orgId={orgId}
            orgData={orgData}
            currency={currency}
            whatsappConnected={setup.whatsappConnected}
            onSaved={(changes) => setOrgData((current) => (current ? { ...current, ...changes } : current))}
            showToast={showToast}
          />
        )}
      </div>

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

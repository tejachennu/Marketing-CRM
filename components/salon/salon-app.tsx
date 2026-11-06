'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Mic, ReceiptText, Settings2 } from 'lucide-react'
import { can } from '@/lib/rbac'
import { api, card, Toast, useToast, useWorkspace } from './ui'
import { SalonSetupTab } from './salon-setup'
import { SalonCounter } from './salon-counter'
import { SalonInvoices } from './salon-invoices'
import { VoiceBar } from './voice-bar'
import type { SalonSetup } from './types'

type Tab = 'counter' | 'invoices' | 'setup'

/** The Spa & Salon connector: the counter, invoices and setup. */
export function SalonApp() {
  const { workspace, error: workspaceError } = useWorkspace()
  const { toast, flash } = useToast()
  const [setup, setSetup] = useState<SalonSetup | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('counter')

  const loadSetup = useCallback(async (orgId: string) => {
    const data = await api(`/api/salon/setup?organizationId=${orgId}`)
    setSetup({ settings: data.settings, services: data.services, staff: data.staff })
    return data
  }, [])

  useEffect(() => {
    if (!workspace) return
    loadSetup(workspace.orgId)
      .then((data) => { if (!data.services?.length && can(workspace.me, 'automation.manage')) setTab('setup') })
      .catch((err) => setError(err.message))
  }, [workspace, loadSetup])

  const canManage = can(workspace?.me, 'automation.manage')
  const tabs: { id: Tab; label: string; icon: typeof Mic }[] = [
    { id: 'counter', label: 'Counter', icon: Mic },
    { id: 'invoices', label: 'Invoices', icon: ReceiptText },
    ...(canManage ? [{ id: 'setup' as const, label: 'Setup', icon: Settings2 }] : []),
  ]

  if (workspaceError || error) {
    return <div className="p-6"><div className={`${card} p-6 text-[15px] text-[#b91c1c]`}>{workspaceError || error}</div></div>
  }
  if (!workspace || !setup) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-[#1D5BEA]" size={30} /></div>
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f6f8fc] dark:bg-[#0b141a]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-7 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-[26px] sm:text-[30px] font-extrabold tracking-tight text-[#0E1B3D] dark:text-white">{setup.settings.business_name || workspace.orgName || 'Salon'}</h1>
            <p className="text-[15px] text-[#4a5672] dark:text-slate-400">Spa & Salon counter</p>
          </div>
          <div role="tablist" className="inline-flex rounded-xl bg-white dark:bg-[#111b21] border border-[#e3e8f2] dark:border-slate-800 p-1 self-start sm:self-auto">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`inline-flex items-center gap-2 h-10 px-4 rounded-lg text-[15px] font-semibold cursor-pointer transition-colors ${tab === id ? 'bg-[#0E1B3D] text-white dark:bg-white dark:text-[#0E1B3D]' : 'text-[#4a5672] dark:text-slate-300 hover:text-[#0E1B3D] dark:hover:text-white'}`}>
                <Icon size={17} /> {label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'setup' && canManage && <SalonSetupTab orgId={workspace.orgId} setup={setup} onChange={setSetup} flash={flash} />}
        {tab === 'counter' && (setup.services.length === 0
          ? <div className={`${card} p-8 text-center text-[15px] text-[#4a5672] dark:text-slate-400`}>{canManage ? 'Add your services in Setup first. "Add sample salon" does it in one tap.' : 'Your manager needs to add services in Setup before the counter can be used.'}</div>
          : <SalonCounter orgId={workspace.orgId} setup={setup} canWrite={can(workspace.me, 'records.write')} flash={flash}
              voice={(handle) => <VoiceBar orgId={workspace.orgId} setup={setup} handle={handle} />} />)}
        {tab === 'invoices' && <SalonInvoices orgId={workspace.orgId} canWrite={can(workspace.me, 'records.write')} canVoid={canManage} flash={flash} />}
      </div>
      <Toast toast={toast} />
    </div>
  )
}

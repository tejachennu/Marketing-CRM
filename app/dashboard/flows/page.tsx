'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { useAlert, useConfirm } from '@/lib/dialog-context'
import { isFlowBetaAllowed } from '@/lib/flows/flow-types'
import { validateWorkflow } from '@/lib/flows/flow-graph'
import { createFormWorkflow, getTriggerSummary } from '@/lib/flows/flow-templates'
import {
  Workflow,
  Plus,
  Sparkles,
  Play,
  Pause,
  Trash2,
  ChevronRight,
  Layers,
  Activity,
  Zap,
  CheckCircle2,
  AlertCircle,
  Bot,
  Smartphone,
  Search,
  FileSpreadsheet,
  Loader2,
  X,
} from 'lucide-react'

interface WorkflowItem {
  id: string
  name: string
  description: string | null
  is_active: boolean
  trigger_type: string
  trigger_config: { keywords?: string[] }
  canvas_nodes: any[]
  canvas_edges: any[]
  execution_count: number
  active_sessions_count?: number
  created_at: string
  updated_at: string
}

interface NativeFlowItem {
  id: string
  name: string
  status: string
  categories: string[]
  flow_id_meta: string | null
  screens: any[]
  created_at: string
}

export default function FlowsHubPage() {
  const router = useRouter()
  const alert = useAlert()
  const confirm = useConfirm()

  const [orgId, setOrgId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'workflows' | 'native_forms' | 'templates'>('workflows')
  const [searchQuery, setSearchQuery] = useState('')

  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [nativeFlows, setNativeFlows] = useState<NativeFlowItem[]>([])

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showAiModal, setShowAiModal] = useState(false)
  const [newFlowName, setNewFlowName] = useState('')
  const [newFlowDescription, setNewFlowDescription] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [isGeneratingAi, setIsGeneratingAi] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isCreatingNativeFlow, setIsCreatingNativeFlow] = useState(false)
  const [loadError, setLoadError] = useState('')

  // Initialize Org
  useEffect(() => {
    async function initUser() {
      try {
        await restoreSupabaseSession()
        const user = authSessionManager.getUser()
        if (!user?.id) return

        const { data: profile } = await supabase
          .from('users')
          .select('organization_id, role, organizations(name, slug)')
          .eq('id', user.id)
          .maybeSingle()

        const org = profile?.organizations as any
        const isAllowed = isFlowBetaAllowed(profile?.organization_id, org?.slug, org?.name) || profile?.role === 'superadmin'

        if (!isAllowed) {
          router.replace('/dashboard')
          return
        }

        if (profile?.organization_id) {
          setOrgId(profile.organization_id)
        } else {
          setLoading(false)
        }
      } catch (err) {
        console.error('Failed to init user in flows page:', err)
        setLoading(false)
      }
    }
    initUser()
  }, [])

  // Load Data
  const loadData = async (organizationId: string) => {
    setLoading(true)
    try {
      const [wfRes, nfRes] = await Promise.all([
        fetch(`/api/flows/workflows?organizationId=${organizationId}`),
        fetch(`/api/flows/native?organizationId=${organizationId}`),
      ])

      if (wfRes.ok) {
        const wfData = await wfRes.json()
        setWorkflows(wfData.workflows || [])
      }

      if (nfRes.ok) {
        const nfData = await nfRes.json()
        setNativeFlows(nfData.flows || [])
      }

      setLoadError(wfRes.ok && nfRes.ok ? '' : 'Some of your flows could not be loaded. Refresh the page to try again.')
    } catch (err) {
      console.error('Failed to load flows data:', err)
      setLoadError('Your flows could not be loaded. Check your connection and refresh the page.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (orgId) {
      loadData(orgId)
    }
  }, [orgId])

  // Toggle active
  const toggleWorkflowActive = async (workflow: WorkflowItem) => {
    try {
      const nextActive = !workflow.is_active
      const res = await fetch(`/api/flows/workflows/${workflow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: nextActive }),
      })

      if (!res.ok) {
        const data = await res.json()
        alert({ title: 'Flow needs attention', message: [data.error, ...(data.validationErrors || [])].filter(Boolean).join('\n') })
        return
      }
      setWorkflows((prev) =>
        prev.map((w) => (w.id === workflow.id ? { ...w, is_active: nextActive } : w))
      )
    } catch (err: any) {
      alert({ title: 'Flow not updated', message: err.message || 'Please try again.' })
    }
  }

  // Delete workflow
  const deleteWorkflow = async (id: string, name: string) => {
    if (!(await confirm({ title: 'Delete this flow?', message: `"${name}" and its conversations in progress will be removed permanently.`, confirmLabel: 'Delete', destructive: true }))) return
    try {
      const res = await fetch(`/api/flows/workflows/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Please try again.')
      }
      setWorkflows((prev) => prev.filter((w) => w.id !== id))
    } catch (err: any) {
      alert({ title: 'Flow not deleted', message: err.message || 'Please try again.' })
    }
  }

  // Delete native flow
  const deleteNativeFlow = async (id: string, name: string) => {
    if (!(await confirm({ title: 'Delete this form?', message: `"${name}" will be removed permanently.`, confirmLabel: 'Delete', destructive: true }))) return
    try {
      const res = await fetch(`/api/flows/native/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        alert({ title: 'Unable to delete form', message: data.error || 'Please try again' })
        return
      }
      setNativeFlows((prev) => prev.filter((f) => f.id !== id))
    } catch (err: any) {
      alert({ title: 'Unable to delete form', message: err.message || 'Please try again.' })
    }
  }

  // Publication is validated by Meta in the form designer.
  const toggleNativeFlowStatus = (flow: NativeFlowItem) => {
    router.push(`/dashboard/flows/native/${flow.id}`)
  }

  // Create a workflow that sends this form and saves the answers as a lead
  const createWorkflowForNativeFlow = async (flow: NativeFlowItem) => {
    if (!orgId) return
    setIsCreating(true)
    try {
      const res = await fetch('/api/flows/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: orgId,
          name: `${flow.name} flow`,
          description: `Sends the "${flow.name}" form and saves the answers as a lead`,
          ...createFormWorkflow(flow),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to create the flow')
      router.push(`/dashboard/flows/${data.workflow.id}`)
    } catch (err: any) {
      setIsCreating(false)
      alert({ title: 'Flow not created', message: err.message })
    }
  }

  // Create workflow manually
  const handleCreateWorkflow = async () => {
    if (!orgId) return
    setIsCreating(true)
    try {
      const res = await fetch('/api/flows/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: orgId,
          name: newFlowName.trim() || 'Untitled flow',
          description: newFlowDescription.trim() || undefined,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setShowCreateModal(false)
        setNewFlowName('')
        setNewFlowDescription('')
        router.push(`/dashboard/flows/${data.workflow.id}`)
      } else {
        const err = await res.json()
        alert({ title: 'Error', message: err.error || 'Failed to create workflow' })
      }
    } catch (err: any) {
      alert({ title: 'Error', message: err.message })
    } finally {
      setIsCreating(false)
    }
  }

  // AI Prompt Generator
  const handleAiGenerate = async () => {
    if (!orgId || !aiPrompt.trim()) return
    setIsGeneratingAi(true)
    try {
      const genRes = await fetch('/api/flows/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: orgId,
          prompt: aiPrompt.trim(),
        }),
      })
      const generated = await genRes.json().catch(() => ({}))
      if (!genRes.ok || !generated.flow) throw new Error(generated.error || 'The flow could not be generated')

      const saveRes = await fetch('/api/flows/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: orgId,
          name: generated.flow.name || 'AI generated flow',
          description: generated.flow.description,
          canvas_nodes: generated.flow.canvas_nodes,
          canvas_edges: generated.flow.canvas_edges,
        }),
      })
      const saved = await saveRes.json().catch(() => ({}))
      if (!saveRes.ok || !saved.workflow) throw new Error(saved.error || 'The generated flow could not be saved')

      setShowAiModal(false)
      setAiPrompt('')
      setIsGeneratingAi(false) // the busy overlay would otherwise cover the notice below
      // Without an AI key the server returns the starter flow; say so rather than pass it off as generated
      if (generated.notice) await alert({ title: 'Starter flow created', message: generated.notice })
      router.push(`/dashboard/flows/${saved.workflow.id}`)
    } catch (err: any) {
      setIsGeneratingAi(false)
      alert({ title: 'Flow not generated', message: err.message || 'Could not generate the flow' })
    }
  }

  // Create Native Flow from Template
  const handleCreateNativeFlow = async (templateKey?: string) => {
    if (!orgId) return
    setIsCreatingNativeFlow(true)
    try {
      const res = await fetch('/api/flows/native', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: orgId,
          template_key: templateKey,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        router.push(`/dashboard/flows/native/${data.flow.id}`)
      } else {
        const err = await res.json()
        alert({ title: 'Error', message: err.error || 'Failed to create native flow' })
      }
    } catch (err: any) {
      alert({ title: 'Error', message: err.message || 'Failed to create native flow' })
    } finally {
      setIsCreatingNativeFlow(false)
    }
  }

  // Filtered lists
  const filteredWorkflows = workflows.filter((w) =>
    w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (w.description && w.description.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const filteredNativeFlows = nativeFlows.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const totalExecutions = workflows.reduce((acc, w) => acc + (w.execution_count || 0), 0)
  const activeSessions = workflows.reduce((acc, w) => acc + (w.active_sessions_count || 0), 0)

  return (
    <div className="w-full h-full overflow-y-auto bg-slate-50 dark:bg-[#0c1317] text-slate-900 dark:text-slate-100 p-4 md:p-8">
      {/* Header */}
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-sm">
                <Workflow className="w-6 h-6" />
              </span>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight">Flows</h1>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Build conversations, collect form responses, and route qualified leads to your team.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setShowAiModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium text-sm hover:from-emerald-700 hover:to-teal-700 shadow-sm shadow-emerald-500/20 transition-all hover:scale-[1.02]"
            >
              <Sparkles className="w-4 h-4 text-emerald-200" />
              <span>Generate with AI</span>
            </button>

            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#008069] text-white font-medium text-sm hover:bg-[#00705c] shadow-sm transition-all hover:scale-[1.02]"
            >
              <Plus className="w-4 h-4" />
              <span>Create Flow</span>
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#111b21] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
              <span>Active Workflows</span>
              <Activity className="w-4 h-4 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold mt-2">
              {workflows.filter((w) => w.is_active).length}
              <span className="text-xs font-normal text-slate-400 ml-1.5">/ {workflows.length} total</span>
            </p>
          </div>

          <div className="bg-white dark:bg-[#111b21] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
              <span>Total Runs</span>
              <Zap className="w-4 h-4 text-amber-500" />
            </div>
            <p className="text-2xl font-bold mt-2">{totalExecutions.toLocaleString()}</p>
          </div>

          <div className="bg-white dark:bg-[#111b21] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
              <span>Conversations In Progress</span>
              <Bot className="w-4 h-4 text-cyan-500" />
            </div>
            <p className="text-2xl font-bold mt-2">{activeSessions}</p>
          </div>

          <div className="bg-white dark:bg-[#111b21] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
              <span>WhatsApp Forms</span>
              <Smartphone className="w-4 h-4 text-indigo-500" />
            </div>
            <p className="text-2xl font-bold mt-2">{nativeFlows.length}</p>
          </div>
        </div>

        {loadError && (
          <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs font-medium text-rose-700 dark:text-rose-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {loadError}
          </div>
        )}

        {/* Tab Navigation & Search */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setActiveTab('workflows')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                activeTab === 'workflows'
                  ? 'bg-[#008069] text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
              }`}
            >
              <Workflow className="w-4 h-4" />
              <span>Flows ({workflows.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('native_forms')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                activeTab === 'native_forms'
                  ? 'bg-[#008069] text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
              }`}
            >
              <Smartphone className="w-4 h-4" />
              <span>WhatsApp Forms ({nativeFlows.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('templates')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                activeTab === 'templates'
                  ? 'bg-[#008069] text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Form Templates</span>
            </button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search flows..."
              className="w-full pl-9 pr-3 py-1.5 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111b21] focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Tab 1: Workflows List */}
        {activeTab === 'workflows' && (
          <div className="space-y-4">
            {loading ? (
              <div className="text-center py-16 text-slate-400">Loading workflows...</div>
            ) : filteredWorkflows.length === 0 ? (
              <div className="text-center py-16 bg-white dark:bg-[#111b21] rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 space-y-3">
                <Workflow className="w-10 h-10 text-slate-400 mx-auto" />
                <h3 className="font-semibold text-lg">{searchQuery ? 'No flows match your search' : 'No flows yet'}</h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                  A flow replies to customers automatically: it can ask questions, collect a form, create leads and tickets, and hand over to your team.
                </p>
                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    onClick={() => setShowAiModal(true)}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium text-xs shadow-sm hover:opacity-95"
                  >
                    Generate with AI
                  </button>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="px-4 py-2 rounded-xl bg-[#008069] text-white font-medium text-xs hover:bg-[#00705c]"
                  >
                    Create a flow
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredWorkflows.map((workflow) => {
                  const trigger = getTriggerSummary(workflow.canvas_nodes || [])
                  const problems = validateWorkflow(workflow.canvas_nodes || [], workflow.canvas_edges || []).length
                  return (
                  <div
                    key={workflow.id}
                    className="bg-white dark:bg-[#111b21] rounded-2xl border border-slate-200/80 dark:border-slate-800/80 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2.5 h-2.5 shrink-0 rounded-full ${
                              workflow.is_active ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                            }`}
                          />
                          <h3 className="font-semibold text-base line-clamp-1 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                            {workflow.name}
                          </h3>
                        </div>
                        <span
                          title={!workflow.is_active && problems ? `${problems} problem${problems === 1 ? '' : 's'} to fix before this flow can go live` : undefined}
                          className={`shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                            workflow.is_active
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                              : problems
                              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                              : 'bg-slate-500/10 text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {workflow.is_active ? 'Live' : problems ? 'Needs fixes' : 'Paused'}
                        </span>
                      </div>

                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 line-clamp-2 min-h-[32px]">
                        {workflow.description || 'No description provided.'}
                      </p>

                      {/* Keywords / Triggers */}
                      <div className="mt-4 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-slate-400 font-medium mr-1">Starts on:</span>
                        {trigger.trigger_type === 'first_message' ? (
                          <span className="text-[11px] text-slate-600 dark:text-slate-300">First message from a customer</span>
                        ) : trigger.trigger_config.keywords.length > 0 ? (
                          trigger.trigger_config.keywords.slice(0, 3).map((kw, i) => (
                            <span
                              key={i}
                              className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                            >
                              {kw}
                            </span>
                          ))
                        ) : (
                          <span className="text-[11px] text-amber-600 dark:text-amber-400">No keywords yet</span>
                        )}
                        {trigger.trigger_type !== 'first_message' && trigger.trigger_config.keywords.length > 3 && (
                          <span className="text-[11px] text-slate-400">
                            +{trigger.trigger_config.keywords.length - 3} more
                          </span>
                        )}
                      </div>

                      {/* Stats badge */}
                      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <Layers className="w-3.5 h-3.5 text-slate-400" />
                            {workflow.canvas_nodes?.length || 0} blocks
                          </span>
                          <span className="flex items-center gap-1">
                            <Zap className="w-3.5 h-3.5 text-amber-500" />
                            {workflow.execution_count || 0} runs
                          </span>
                        </div>
                        {workflow.active_sessions_count ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            {workflow.active_sessions_count} active
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* Bottom Actions */}
                    <div className="mt-5 flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800/80">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => toggleWorkflowActive(workflow)}
                          title={workflow.is_active ? 'Pause flow' : 'Go live'}
                          aria-label={workflow.is_active ? `Pause ${workflow.name}` : `Go live with ${workflow.name}`}
                          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                            workflow.is_active
                              ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                              : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                          }`}
                        >
                          {workflow.is_active ? (
                            <Pause className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => deleteWorkflow(workflow.id, workflow.name)}
                          title="Delete flow"
                          aria-label={`Delete ${workflow.name}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <Link
                          href={`/dashboard/flows/submissions?workflowId=${workflow.id}&name=${encodeURIComponent(workflow.name)}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#162026] text-slate-700 dark:text-slate-200 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 shadow-2xs transition-all whitespace-nowrap"
                          title="View submitted responses"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                          <span>Responses</span>
                        </Link>
                        <Link
                          href={`/dashboard/flows/${workflow.id}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#008069] hover:bg-[#00705c] text-white text-xs font-semibold shadow-xs transition-all whitespace-nowrap"
                        >
                          <span>Edit</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Meta Native Forms */}
        {activeTab === 'native_forms' && (
          <div className="space-y-4">
            <div className="bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-indigo-500/10 border border-emerald-500/20 p-4 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Smartphone className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <h4 className="font-semibold text-sm">WhatsApp forms</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Forms open inside WhatsApp, so customers never leave the chat. Publish a form, then send it from a flow.
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleCreateNativeFlow()}
                className="px-3.5 py-1.5 rounded-xl bg-[#008069] text-white text-xs font-semibold hover:bg-[#00705c] transition-all flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>New form</span>
              </button>
            </div>

            {loading ? (
              <div className="text-center py-16 text-slate-400">Loading native forms...</div>
            ) : filteredNativeFlows.length === 0 ? (
              <div className="text-center py-16 bg-white dark:bg-[#111b21] rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 space-y-3">
                <Smartphone className="w-10 h-10 text-slate-400 mx-auto" />
                <h3 className="font-semibold text-lg">{searchQuery ? 'No forms match your search' : 'No forms yet'}</h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                  Design multi-screen forms with text fields, dropdowns, date pickers and single-choice options.
                </p>
                <button
                  onClick={() => handleCreateNativeFlow()}
                  className="px-4 py-2 rounded-xl bg-[#008069] text-white font-medium text-xs hover:bg-[#00705c]"
                >
                  Create your first form
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredNativeFlows.map((flow) => (
                  <div
                    key={flow.id}
                    className="bg-white dark:bg-[#111b21] rounded-2xl border border-slate-200/80 dark:border-slate-800/80 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono uppercase bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-500/20 font-bold">
                          {flow.categories?.[0] || 'FORM'}
                        </span>
                        <button
                          onClick={() => toggleNativeFlowStatus(flow)}
                          title={flow.status === 'PUBLISHED' && Boolean(flow.flow_id_meta) ? 'Approved and published on Meta WhatsApp Cloud API' : 'Click to open Screen Designer and publish'}
                          className={`text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full cursor-pointer transition-colors flex items-center gap-1.5 ${
                            flow.status === 'PUBLISHED' && Boolean(flow.flow_id_meta)
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                              : flow.flow_id_meta
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/25'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          {flow.status === 'PUBLISHED' && Boolean(flow.flow_id_meta) ? (
                            <>
                              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                              <span>Published</span>
                            </>
                          ) : flow.flow_id_meta ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              <span>Draft on Meta</span>
                            </>
                          ) : (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                              <span>Draft</span>
                            </>
                          )}
                        </button>
                      </div>

                      <h3 className="font-semibold text-base mt-2 line-clamp-1">{flow.name}</h3>

                      <div className="mt-2.5 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                        <span>{flow.screens?.length || 1} Screen(s)</span>
                        <span>•</span>
                        <span>WhatsApp Form</span>
                      </div>

                      {/* Approval Status Confirmation */}
                      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                        {flow.status === 'PUBLISHED' && Boolean(flow.flow_id_meta) ? (
                          <>
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                              <span>Live on WhatsApp</span>
                            </span>
                            <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 truncate" title={`Meta Flow ID: ${flow.flow_id_meta}`}>
                              ID: {flow.flow_id_meta}
                            </span>
                          </>
                        ) : flow.flow_id_meta ? (
                          <>
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-md border border-amber-200 dark:border-amber-800">
                              <span>Validated by Meta, not published</span>
                            </span>
                            <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 truncate">
                              ID: {flow.flow_id_meta}
                            </span>
                          </>
                        ) : (
                          <span className="text-[10px] text-slate-400 dark:text-slate-500">
                            Draft: not yet sent to Meta
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-5 flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800/80 gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => deleteNativeFlow(flow.id, flow.name)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
                          title="Delete Form"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => createWorkflowForNativeFlow(flow)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-xs font-medium transition-colors"
                          title="Create a flow that sends this form and saves the answers as a lead"
                        >
                          <Zap className="w-3.5 h-3.5 text-amber-500" />
                          <span className="hidden sm:inline">Use in a flow</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <Link
                          href={`/dashboard/flows/submissions?flowId=${flow.id}&name=${encodeURIComponent(flow.name)}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#162026] text-slate-700 dark:text-slate-200 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 shadow-2xs transition-all whitespace-nowrap"
                          title="View submitted responses"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                          <span>Responses</span>
                        </Link>

                        <Link
                          href={`/dashboard/flows/native/${flow.id}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#008069] hover:bg-[#00705c] text-white text-xs font-semibold shadow-xs transition-all whitespace-nowrap"
                        >
                          <span>Designer</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Pre-Built Templates */}
        {activeTab === 'templates' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-[#111b21] p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm space-y-4">
              <span className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-lg">
                📋
              </span>
              <h3 className="font-bold text-base">Lead qualification form</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Collects name, company, budget range and marketing consent. After publishing, choose “Use in a flow” to save answers as leads.
              </p>
              <button
                onClick={() => handleCreateNativeFlow('LEAD_QUALIFICATION')}
                className="w-full py-2 rounded-xl bg-[#008069] text-white text-xs font-semibold hover:bg-[#00705c] transition-colors"
              >
                Use this template
              </button>
            </div>

            <div className="bg-white dark:bg-[#111b21] p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm space-y-4">
              <span className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold text-lg">
                📅
              </span>
              <h3 className="font-bold text-base">Appointment booking form</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Collects a topic, preferred date and time, and notes. Bookings arrive as form responses; calendars are not updated automatically.
              </p>
              <button
                onClick={() => handleCreateNativeFlow('APPOINTMENT_BOOKING')}
                className="w-full py-2 rounded-xl bg-[#008069] text-white text-xs font-semibold hover:bg-[#00705c] transition-colors"
              >
                Use this template
              </button>
            </div>

            <div className="bg-white dark:bg-[#111b21] p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm space-y-4">
              <span className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-lg">
                ⭐
              </span>
              <h3 className="font-bold text-base">Customer feedback form</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Collects a satisfaction rating and a comment. Add a Condition block in a flow to open a ticket for low ratings.
              </p>
              <button
                onClick={() => handleCreateNativeFlow('CUSTOMER_FEEDBACK')}
                className="w-full py-2 rounded-xl bg-[#008069] text-white text-xs font-semibold hover:bg-[#00705c] transition-colors"
              >
                Use this template
              </button>
            </div>
          </div>
        )}
      </div>

      {/* AI Generate Flow Modal */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Generate a flow with AI">
          <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-lg p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white">
                  <Sparkles className="w-5 h-5" />
                </span>
                <h3 className="font-bold text-lg">Generate a flow with AI</h3>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setShowAiModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
Describe the conversation you want in plain English. The AI drafts the trigger, messages, buttons and CRM actions; you then review and adjust it in the builder before it goes live.
            </p>

            <textarea
              rows={4}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="e.g. Build an inbound lead qualification flow for our luxury car rental service. Greet the customer, ask if they want sports or SUV, collect rental dates with WhatsApp native form, and create a high-priority deal for our sales reps."
              className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0c1317] text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />

            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Example Prompts</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Real estate enquiry: ask buy or rent, then create a lead',
                  'Order help: ask what went wrong, open a ticket, hand off to support',
                  'Dental clinic: offer cleaning, whitening or check-up and create a lead',
                ].map((sample, i) => (
                  <button
                    key={i}
                    onClick={() => setAiPrompt(sample)}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/40 transition-colors"
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setShowAiModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleAiGenerate}
                disabled={isGeneratingAi || !aiPrompt.trim()}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium text-sm hover:from-emerald-700 hover:to-teal-700 shadow-sm disabled:opacity-50 flex items-center gap-2"
              >
                {isGeneratingAi ? (
                  <>
                    <Sparkles className="w-4 h-4 animate-spin" />
                    <span>Generating…</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Generate flow</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Create Flow Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Create a flow">
          <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-lg">Create a flow</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              You start with a working example: a welcome message and a menu that creates a lead, opens a ticket, or lets the AI answer. Change anything you like.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Flow Name</label>
                <input
                  type="text"
                  value={newFlowName}
                  onChange={(e) => setNewFlowName(e.target.value)}
                  placeholder="e.g. Inbound Website Lead Funnel"
                  className="w-full mt-1 p-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0c1317] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Description (Optional)</label>
                <input
                  type="text"
                  value={newFlowDescription}
                  onChange={(e) => setNewFlowDescription(e.target.value)}
                  placeholder="e.g. Triggered when customers message 'pricing' or 'demo'"
                  className="w-full mt-1 p-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0c1317] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={() => handleCreateWorkflow()}
                disabled={isCreating}
                className="px-5 py-2 rounded-xl bg-[#008069] text-white font-medium text-sm hover:bg-[#00705c] disabled:opacity-50"
              >
                {isCreating ? 'Creating…' : 'Create and open'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Busy overlay while something is being created */}
      {(isCreating || isGeneratingAi || isCreatingNativeFlow) && (
        <div className="fixed inset-0 z-[60] bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4" role="status" aria-live="polite">
          <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl px-6 py-5 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-emerald-500 animate-spin shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {isGeneratingAi ? 'Generating your flow…' : isCreatingNativeFlow ? 'Creating the form…' : 'Creating the flow…'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isGeneratingAi ? 'This usually takes a few seconds.' : 'Opening the editor when it is ready.'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { useAlert } from '@/lib/dialog-context'
import { isFlowBetaAllowed } from '@/lib/flows/flow-types'
import {
  Workflow,
  Plus,
  Sparkles,
  Play,
  Pause,
  Trash2,
  ExternalLink,
  ChevronRight,
  Layers,
  FileText,
  Activity,
  Zap,
  HelpCircle,
  Copy,
  CheckCircle2,
  AlertCircle,
  Bot,
  Settings2,
  ArrowRight,
  FileCode2,
  Smartphone,
  Search,
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
  meta_flow_id: string | null
  screens: any[]
  created_at: string
}

export default function FlowsHubPage() {
  const router = useRouter()
  const alert = useAlert()

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
        }
      } catch (err) {
        console.error('Failed to init user in flows page:', err)
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
    } catch (err) {
      console.error('Failed to load flows data:', err)
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

      if (res.ok) {
        setWorkflows((prev) =>
          prev.map((w) => (w.id === workflow.id ? { ...w, is_active: nextActive } : w))
        )
      }
    } catch (err) {
      console.error('Failed to toggle workflow status:', err)
    }
  }

  // Delete workflow
  const deleteWorkflow = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete workflow "${name}"?`)) return
    try {
      const res = await fetch(`/api/flows/workflows/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setWorkflows((prev) => prev.filter((w) => w.id !== id))
      }
    } catch (err) {
      console.error('Failed to delete workflow:', err)
    }
  }

  // Delete native flow
  const deleteNativeFlow = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete native flow "${name}"?`)) return
    try {
      const res = await fetch(`/api/flows/native/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setNativeFlows((prev) => prev.filter((f) => f.id !== id))
      }
    } catch (err) {
      console.error('Failed to delete native flow:', err)
    }
  }

  // Toggle native flow status (PUBLISHED / DRAFT)
  const toggleNativeFlowStatus = async (flow: NativeFlowItem) => {
    const nextStatus = flow.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED'
    try {
      const res = await fetch(`/api/flows/native/${flow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (res.ok) {
        setNativeFlows((prev) =>
          prev.map((f) => (f.id === flow.id ? { ...f, status: nextStatus } : f))
        )
      }
    } catch (err) {
      console.error('Failed to toggle native flow status:', err)
    }
  }

  // Create an automated conversational workflow that triggers this native form
  const createWorkflowForNativeFlow = async (flow: NativeFlowItem) => {
    if (!orgId) return
    try {
      const nodes = [
        {
          id: 'node-trigger-1',
          type: 'trigger',
          position: { x: 100, y: 180 },
          data: {
            title: 'Customer Trigger',
            trigger_type: 'keyword',
            keywords: ['hi', 'hello', 'start', 'form', 'apply'],
            match_mode: 'fuzzy',
          },
        },
        {
          id: 'node-msg-intro',
          type: 'message',
          position: { x: 420, y: 180 },
          data: {
            title: 'Welcome Message',
            body: `Hello! 👋 Please complete our quick form below:`,
          },
        },
        {
          id: 'node-native-form',
          type: 'native_flow_trigger',
          position: { x: 740, y: 180 },
          data: {
            title: flow.name,
            cta_text: 'Open WhatsApp Form',
            native_flow_id: flow.id,
            flow_token: 'token_' + Date.now(),
          },
        },
        {
          id: 'node-deal-create',
          type: 'crm_deal_action',
          position: { x: 1060, y: 180 },
          data: {
            title: 'Capture Lead in Pipeline',
            pipeline_stage: 'lead_in',
            deal_name: `Lead: ${flow.name}`,
            monetary_value: 500,
          },
        },
      ]

      const edges = [
        { id: 'e1', source: 'node-trigger-1', target: 'node-msg-intro' },
        { id: 'e2', source: 'node-msg-intro', target: 'node-native-form' },
        { id: 'e3', source: 'node-native-form', target: 'node-deal-create' },
      ]

      const res = await fetch('/api/flows/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: orgId,
          name: `${flow.name} (Automation)`,
          description: `Conversational workflow delivering the native WhatsApp form "${flow.name}"`,
          canvas_nodes: nodes,
          canvas_edges: edges,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        router.push(`/dashboard/flows/${data.workflow.id}`)
      }
    } catch (err: any) {
      alert({ title: 'Error', message: err.message })
    }
  }

  // Create workflow manually
  const handleCreateWorkflow = async (templateId?: string) => {
    if (!orgId) return
    setIsCreating(true)
    try {
      const res = await fetch('/api/flows/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: orgId,
          name: newFlowName.trim() || 'Untitled WhatsApp Flow',
          description: newFlowDescription.trim() || undefined,
          template_id: templateId,
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

      if (!genRes.ok) {
        throw new Error('AI failed to generate flow')
      }

      const { flow } = await genRes.json()

      // Save as new workflow
      const saveRes = await fetch('/api/flows/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: orgId,
          name: flow.name || 'AI Generated Flow',
          description: flow.description,
          canvas_nodes: flow.canvas_nodes,
          canvas_edges: flow.canvas_edges,
        }),
      })

      if (saveRes.ok) {
        const { workflow } = await saveRes.json()
        setShowAiModal(false)
        setAiPrompt('')
        router.push(`/dashboard/flows/${workflow.id}`)
      }
    } catch (err: any) {
      alert({ title: 'Generation Failed', message: err.message || 'Could not generate workflow graph' })
    } finally {
      setIsGeneratingAi(false)
    }
  }

  // Create Native Flow from Template
  const handleCreateNativeFlow = async (templateKey?: string) => {
    if (!orgId) return
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
      }
    } catch (err) {
      console.error('Failed to create native flow:', err)
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
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-[#0c1317] text-slate-900 dark:text-slate-100 p-4 md:p-8">
      {/* Header */}
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-sm">
                <Workflow className="w-6 h-6" />
              </span>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">WhatsApp Flows & Automation</h1>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Visual drag & drop workflows, Meta WhatsApp Native Forms (v3.1), and AI RAG mid-flow self-healing.
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
              <span>Fired Executions</span>
              <Zap className="w-4 h-4 text-amber-500" />
            </div>
            <p className="text-2xl font-bold mt-2">{totalExecutions.toLocaleString()}</p>
          </div>

          <div className="bg-white dark:bg-[#111b21] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
              <span>Active Live Sessions</span>
              <Bot className="w-4 h-4 text-cyan-500" />
            </div>
            <p className="text-2xl font-bold mt-2">{activeSessions}</p>
          </div>

          <div className="bg-white dark:bg-[#111b21] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
              <span>Meta Native Forms</span>
              <Smartphone className="w-4 h-4 text-indigo-500" />
            </div>
            <p className="text-2xl font-bold mt-2">{nativeFlows.length}</p>
          </div>
        </div>

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
              <span>Workflows ({workflows.length})</span>
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
              <span>Meta Native Forms ({nativeFlows.length})</span>
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
              <span>Templates</span>
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
                <h3 className="font-semibold text-lg">No Workflows Found</h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                  Create your first drag & drop WhatsApp flow or let AI generate an end-to-end qualification graph in seconds.
                </p>
                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    onClick={() => setShowAiModal(true)}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium text-xs shadow-sm hover:opacity-95"
                  >
                    ✨ Generate with AI
                  </button>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="px-4 py-2 rounded-xl bg-[#008069] text-white font-medium text-xs hover:bg-[#00705c]"
                  >
                    + Create Blank Flow
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredWorkflows.map((workflow) => (
                  <div
                    key={workflow.id}
                    className="bg-white dark:bg-[#111b21] rounded-2xl border border-slate-200/80 dark:border-slate-800/80 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2.5 h-2.5 rounded-full ${
                              workflow.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                            }`}
                          />
                          <h3 className="font-semibold text-base line-clamp-1 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                            {workflow.name}
                          </h3>
                        </div>
                        <span
                          className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                            workflow.is_active
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                              : 'bg-slate-500/10 text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {workflow.is_active ? 'Live' : 'Paused'}
                        </span>
                      </div>

                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 line-clamp-2 min-h-[32px]">
                        {workflow.description || 'No description provided.'}
                      </p>

                      {/* Keywords / Triggers */}
                      <div className="mt-4 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-slate-400 font-medium mr-1">Triggers:</span>
                        {workflow.trigger_config?.keywords && workflow.trigger_config.keywords.length > 0 ? (
                          workflow.trigger_config.keywords.slice(0, 3).map((kw, i) => (
                            <span
                              key={i}
                              className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                            >
                              "{kw}"
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-slate-400">All inbound messages</span>
                        )}
                        {(workflow.trigger_config?.keywords?.length || 0) > 3 && (
                          <span className="text-[10px] text-slate-400">
                            +{workflow.trigger_config.keywords!.length - 3} more
                          </span>
                        )}
                      </div>

                      {/* Stats badge */}
                      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <Layers className="w-3.5 h-3.5 text-slate-400" />
                            {workflow.canvas_nodes?.length || 0} nodes
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
                          title={workflow.is_active ? 'Pause Flow' : 'Activate Flow'}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          {workflow.is_active ? (
                            <Pause className="w-4 h-4 text-amber-500" />
                          ) : (
                            <Play className="w-4 h-4 text-emerald-500" />
                          )}
                        </button>
                        <button
                          onClick={() => deleteWorkflow(workflow.id, workflow.name)}
                          title="Delete Flow"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <Link
                        href={`/dashboard/flows/${workflow.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                      >
                        <span>Open Canvas</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Meta Native Forms (v3.1) */}
        {activeTab === 'native_forms' && (
          <div className="space-y-4">
            <div className="bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-indigo-500/10 border border-emerald-500/20 p-4 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Smartphone className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <h4 className="font-semibold text-sm">WhatsApp Native Flow Sheets (Meta Specification v3.1)</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Interactive native forms render inside WhatsApp with zero external webview or URL redirects.
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleCreateNativeFlow()}
                className="px-3.5 py-1.5 rounded-xl bg-[#008069] text-white text-xs font-semibold hover:bg-[#00705c] transition-all flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>New Native Form</span>
              </button>
            </div>

            {loading ? (
              <div className="text-center py-16 text-slate-400">Loading native forms...</div>
            ) : filteredNativeFlows.length === 0 ? (
              <div className="text-center py-16 bg-white dark:bg-[#111b21] rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 space-y-3">
                <Smartphone className="w-10 h-10 text-slate-400 mx-auto" />
                <h3 className="font-semibold text-lg">No Native WhatsApp Forms Yet</h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                  Design rich multi-screen WhatsApp forms with text inputs, dropdowns, date pickers, and radio chips.
                </p>
                <button
                  onClick={() => handleCreateNativeFlow()}
                  className="px-4 py-2 rounded-xl bg-[#008069] text-white font-medium text-xs hover:bg-[#00705c]"
                >
                  Create Your First Native Form
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
                          title="Click to toggle PUBLISHED / DRAFT"
                          className={`text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full cursor-pointer transition-colors flex items-center gap-1.5 ${
                            flow.status === 'PUBLISHED'
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                              : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/25'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              flow.status === 'PUBLISHED' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                            }`}
                          />
                          <span>{flow.status}</span>
                        </button>
                      </div>

                      <h3 className="font-semibold text-base mt-2 line-clamp-1">{flow.name}</h3>

                      <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
                        <span>{flow.screens?.length || 1} Screen(s)</span>
                        <span>•</span>
                        <span>Meta Spec v3.1</span>
                      </div>
                    </div>

                    <div className="mt-5 flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800/80 gap-2">
                      <button
                        onClick={() => deleteNativeFlow(flow.id, flow.name)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
                        title="Delete Form"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => createWorkflowForNativeFlow(flow)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-semibold hover:bg-emerald-500/20 transition-colors"
                          title="Create an automated conversational trigger to send this form"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>⚡ Activate in Flow</span>
                        </button>

                        <Link
                          href={`/dashboard/flows/native/${flow.id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 text-xs font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                        >
                          <span>Screen Designer</span>
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
              <h3 className="font-bold text-base">VIP Lead Qualification</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Asks customer requirements, opens native WhatsApp form for company & budget, and auto-creates a deal in your Sales Pipeline.
              </p>
              <button
                onClick={() => handleCreateNativeFlow('LEAD_QUALIFICATION')}
                className="w-full py-2 rounded-xl bg-[#008069] text-white text-xs font-semibold hover:bg-[#00705c] transition-colors"
              >
                Instantiate Template
              </button>
            </div>

            <div className="bg-white dark:bg-[#111b21] p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm space-y-4">
              <span className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold text-lg">
                📅
              </span>
              <h3 className="font-bold text-base">Appointment & Demo Booking</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                In-chat service picker, date & time selector, and automated confirmation message with calendar sync.
              </p>
              <button
                onClick={() => handleCreateNativeFlow('APPOINTMENT_BOOKING')}
                className="w-full py-2 rounded-xl bg-[#008069] text-white text-xs font-semibold hover:bg-[#00705c] transition-colors"
              >
                Instantiate Template
              </button>
            </div>

            <div className="bg-white dark:bg-[#111b21] p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm space-y-4">
              <span className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-lg">
                ⭐
              </span>
              <h3 className="font-bold text-base">NPS & Customer Feedback</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Capture 1-5 star ratings, feedback comments, and automatically escalate dissatisfied responses into urgent support tickets.
              </p>
              <button
                onClick={() => handleCreateNativeFlow('CUSTOMER_FEEDBACK')}
                className="w-full py-2 rounded-xl bg-[#008069] text-white text-xs font-semibold hover:bg-[#00705c] transition-colors"
              >
                Instantiate Template
              </button>
            </div>
          </div>
        )}
      </div>

      {/* AI Generate Flow Modal */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-lg p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white">
                  <Sparkles className="w-5 h-5" />
                </span>
                <h3 className="font-bold text-lg">Prompt-to-Flow AI Architect</h3>
              </div>
              <button
                onClick={() => setShowAiModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Describe your desired WhatsApp campaign or workflow in plain English. Our AI will lay out the triggers, interactive buttons, Meta forms, CRM deals, and knowledge RAG interceptors.
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
                  'VIP Real Estate consultation with budget picker',
                  'E-commerce order tracking with customer support fallback',
                  'Dental clinic teeth cleaning booking with SMS reminder',
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
                    <span>Synthesizing Graph...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Generate Workflow</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Create Flow Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-lg">Create New Workflow</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Start with a blank canvas and drag blocks to build your conversational WhatsApp journey.
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
                {isCreating ? 'Creating...' : 'Open Canvas Builder'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

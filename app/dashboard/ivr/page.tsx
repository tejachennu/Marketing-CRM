'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { User, Organization } from '@/lib/types'
import { Phone, ArrowLeft, Check, X, Plus, Loader2, Trash2 } from 'lucide-react'
import { useConfirm } from '@/lib/dialog-context'

export default function IVRWorkflowsPage() {
  const confirm = useConfirm()
  const [user, setUser] = useState<User | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [webhookUrl, setWebhookUrl] = useState('')

  // Layout Tab State
  const [voiceTab, setVoiceTab] = useState<'workflows' | 'ai_agent'>('workflows')

  // Voice IVR Workflows State
  const [workflows, setWorkflows] = useState<any[]>([])
  const [loadingWorkflows, setLoadingWorkflows] = useState(false)
  const [selectedWorkflow, setSelectedWorkflow] = useState<any | null>(null)
  const [editWorkflowSteps, setEditWorkflowSteps] = useState<any[]>([])
  const [showAddWorkflowModal, setShowAddWorkflowModal] = useState(false)
  const [newWorkflowName, setNewWorkflowName] = useState('')
  const [newWorkflowDescription, setNewWorkflowDescription] = useState('')
  const [savingWorkflow, setSavingWorkflow] = useState(false)

  // AI Realtime Agent State
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiVariables, setAiVariables] = useState('')
  const [aiCalls, setAiCalls] = useState<any[]>([])
  const [loadingAiCalls, setLoadingAiCalls] = useState(false)
  const [savingAiSettings, setSavingAiSettings] = useState(false)

  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info'
    message: string
    title?: string
  } | null>(null)

  const notificationTimeoutRef = useRef<any>(null)

  function showNotification(type: 'success' | 'error' | 'info', message: string, title = '') {
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current)
    }
    setNotification({ type, message, title })
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null)
      notificationTimeoutRef.current = null
    }, 5000)
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (user?.organization_id) {
      if (voiceTab === 'workflows') {
        loadWorkflows(user.organization_id)
      } else if (voiceTab === 'ai_agent') {
        loadAiSettings(user.organization_id)
        loadAiCalls(user.organization_id)
      }
    }
  }, [user, voiceTab])

  async function loadData() {
    try {
      await restoreSupabaseSession()

      let userId: string | null = null
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser) {
        userId = authUser.id
      } else {
        const storedUser = authSessionManager.getUser()
        if (storedUser?.id) {
          userId = storedUser.id
        }
      }

      if (!userId) return

      const email = authUser?.email || authSessionManager.getUser()?.email || ''
      const userData = await ensureUserProfile(userId, email)
      if (!userData) return

      setUser(userData)

      const { data: orgData } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', userData.organization_id)
        .single()

      setOrganization(orgData)

      if (typeof window !== 'undefined') {
        setWebhookUrl(`${window.location.origin}/api/webhooks/voice`)
      }
    } catch (error) {
      console.error('Error loading user data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadWorkflows(orgId: string) {
    setLoadingWorkflows(true)
    try {
      const res = await fetch(`/api/voice-workflows?organizationId=${orgId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load workflows')
      setWorkflows(data.workflows || [])
    } catch (err: any) {
      console.error('Failed to load workflows:', err)
      showNotification('error', err.message || 'Failed to load workflows', 'Error Loading Workflows')
    } finally {
      setLoadingWorkflows(false)
    }
  }

  async function handleCreateWorkflow() {
    if (!newWorkflowName.trim() || !user) return
    setActionLoading(true)
    try {
      const res = await fetch('/api/voice-workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: user.organization_id,
          name: newWorkflowName.trim(),
          description: newWorkflowDescription.trim()
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create workflow')
      
      setNewWorkflowName('')
      setNewWorkflowDescription('')
      setShowAddWorkflowModal(false)
      showNotification('success', 'Voice workflow created successfully!', 'Workflow Created')
      await loadWorkflows(user.organization_id)
      
      // Select for editing immediately
      setSelectedWorkflow(data.workflow)
      setEditWorkflowSteps(data.workflow.steps || [])
    } catch (err: any) {
      console.error('Create workflow error:', err)
      showNotification('error', err.message || 'Failed to create workflow.', 'Error')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleToggleActive(workflowId: string, currentStatus: boolean) {
    if (!user) return
    try {
      const res = await fetch('/api/voice-workflows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: workflowId,
          isActive: !currentStatus
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update workflow')
      
      showNotification('success', `Workflow ${!currentStatus ? 'activated' : 'deactivated'} successfully!`, 'Status Updated')
      await loadWorkflows(user.organization_id)
    } catch (err: any) {
      console.error('Toggle active error:', err)
      showNotification('error', err.message || 'Failed to toggle status.', 'Error')
    }
  }

  async function handleDeleteWorkflow(id: string) {
    if (!user) return
    const confirmed = await confirm({
      title: 'Delete Workflow',
      message: 'Are you sure you want to delete this voice workflow? This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel'
    })
    if (!confirmed) return
    try {
      const res = await fetch(`/api/voice-workflows?id=${id}`, {
        method: 'DELETE'
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Delete failed')
      }
      showNotification('success', 'Voice workflow deleted successfully!', 'Workflow Deleted')
      
      if (selectedWorkflow?.id === id) {
        setSelectedWorkflow(null)
      }
      await loadWorkflows(user.organization_id)
    } catch (err: any) {
      console.error('Delete workflow error:', err)
      showNotification('error', err.message || 'Failed to delete workflow.', 'Error')
    }
  }

  async function handleSaveWorkflowSteps() {
    if (!selectedWorkflow || !user) return
    setSavingWorkflow(true)
    try {
      const stepIds = editWorkflowSteps.map(s => s.id.trim())
      const uniqueStepIds = new Set(stepIds)
      
      if (uniqueStepIds.size !== stepIds.length) {
        throw new Error('All steps must have unique Step IDs.')
      }

      if (stepIds.some(id => !id)) {
        throw new Error('Step ID cannot be empty.')
      }

      // Format numeric parameters correctly
      const formattedSteps = editWorkflowSteps.map(step => {
        if (step.type === 'gather') {
          return {
            ...step,
            numDigits: parseInt(step.numDigits) || 1,
            timeout: parseInt(step.timeout) || 5
          }
        }
        return step
      })

      const res = await fetch('/api/voice-workflows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedWorkflow.id,
          steps: formattedSteps
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save workflow steps')
      
      showNotification('success', 'Workflow steps saved successfully!', 'Steps Saved')
      setSelectedWorkflow(data.workflow)
      setEditWorkflowSteps(data.workflow.steps || [])
      await loadWorkflows(user.organization_id)
    } catch (err: any) {
      console.error('Save workflow steps error:', err)
      showNotification('error', err.message || 'Failed to save steps.', 'Error')
    } finally {
      setSavingWorkflow(false)
    }
  }

  function handleAddStep(type: 'say' | 'gather' | 'dial' | 'record' | 'hangup') {
    const defaultIds = {
      say: 'say_step',
      gather: 'gather_step',
      dial: 'dial_step',
      record: 'record_step',
      hangup: 'hangup_step'
    }
    const suffix = Math.floor(1000 + Math.random() * 9000)
    const newId = `${defaultIds[type]}_${suffix}`

    const newStep: any = {
      id: newId,
      type
    }

    if (type === 'say') {
      newStep.text = 'Welcome. We are glad you called.'
      newStep.next_step = null
    } else if (type === 'gather') {
      newStep.prompt = 'Press 1 to continue, or press 2 for help.'
      newStep.numDigits = 1
      newStep.timeout = 5
      newStep.routes = {}
    } else if (type === 'dial') {
      newStep.phoneNumber = ''
    } else if (type === 'record') {
      newStep.text = 'Please leave your message after the tone. Press pound when finished.'
      newStep.next_step = null
    }

    setEditWorkflowSteps(prev => [...prev, newStep])
  }

  function handleDeleteStep(index: number) {
    setEditWorkflowSteps(prev => prev.filter((_, i) => i !== index))
  }

  function handleUpdateStepField(index: number, field: string, value: any) {
    setEditWorkflowSteps(prev => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  function handleUpdateGatherRoute(stepIndex: number, digit: string, targetStepId: string | null) {
    setEditWorkflowSteps(prev => {
      const next = [...prev]
      const step = { ...next[stepIndex] }
      const routes = { ...step.routes }
      if (targetStepId === null || targetStepId === '') {
        delete routes[digit]
      } else {
        routes[digit] = targetStepId
      }
      step.routes = routes
      next[stepIndex] = step
      return next
    })
  }

  // AI Realtime API integration helpers
  async function loadAiSettings(orgId: string) {
    try {
      const res = await fetch(`/api/ai-realtime?organizationId=${orgId}&type=settings`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load settings')
      if (data.settings) {
        setAiPrompt(data.settings.ai_realtime_prompt || '')
        setAiVariables((data.settings.ai_realtime_variables || []).join(', '))
      }
    } catch (err: any) {
      console.error('Error loading AI Realtime settings:', err)
    }
  }

  async function loadAiCalls(orgId: string) {
    setLoadingAiCalls(true)
    try {
      const res = await fetch(`/api/ai-realtime?organizationId=${orgId}&type=calls`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load calls')
      setAiCalls(data.calls || [])
    } catch (err: any) {
      console.error('Error loading AI Realtime calls:', err)
      showNotification('error', err.message || 'Failed to load call logs', 'Error')
    } finally {
      setLoadingAiCalls(false)
    }
  }

  async function handleSaveAiSettings() {
    if (!user) return
    setSavingAiSettings(true)
    try {
      const res = await fetch('/api/ai-realtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: user.organization_id,
          customPrompt: aiPrompt.trim(),
          variables: aiVariables
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save settings')
      showNotification('success', 'AI voice assistant settings saved successfully!', 'Settings Saved')
      await loadAiSettings(user.organization_id)
    } catch (err: any) {
      console.error('Error saving AI Realtime settings:', err)
      showNotification('error', err.message || 'Failed to save settings.', 'Error')
    } finally {
      setSavingAiSettings(false)
    }
  }

  const [actionLoading, setActionLoading] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00a884]"></div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 font-sans h-full overflow-y-auto space-y-6 relative">
      {notification && (
        <div className="fixed top-4 right-4 z-50 flex items-start gap-3 bg-white p-4 rounded-xl border border-[#e9edef] shadow-xl animate-in slide-in-from-top-4 duration-300 max-w-sm w-full select-none" style={{ borderLeft: `4px solid ${notification.type === 'success' ? '#00a884' : notification.type === 'error' ? '#ef4444' : '#3b82f6'}` }}>
          <div className="flex-1 min-w-0">
            {notification.title && (
              <h4 className="text-xs font-bold text-[#111b21] mb-1">{notification.title}</h4>
            )}
            <p className="text-[11px] text-[#54656f] font-semibold leading-relaxed whitespace-pre-line">
              {notification.message}
            </p>
          </div>
          <button 
            onClick={() => setNotification(null)}
            className="text-[#8696a0] hover:text-[#54656f] hover:bg-[#f0f2f5] p-1 rounded-full cursor-pointer transition-colors"
          >
            <Plus size={14} className="rotate-45" />
          </button>
        </div>
      )}

      <div className="mb-6 select-none flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111b21]">Voice Calling Workflows</h1>
          <p className="text-xs text-[#667781] mt-1 font-semibold">Configure interactive voice menus, static IVR systems, and dynamic AI streaming agents</p>
        </div>
      </div>

      {/* Voice Tabs */}
      <div className="flex border-b border-[#e9edef] mb-6 select-none animate-in fade-in duration-300">
        <button
          onClick={() => setVoiceTab('workflows')}
          className={`px-4 py-2 text-xs font-bold transition-all cursor-pointer border-b-2 ${
            voiceTab === 'workflows'
              ? 'border-[#00a884] text-[#008069]'
              : 'border-transparent text-[#8696a0] hover:text-[#54656f]'
          }`}
        >
          Standard IVR Call Trees
        </button>
        <button
          onClick={() => setVoiceTab('ai_agent')}
          className={`px-4 py-2 text-xs font-bold transition-all cursor-pointer border-b-2 flex items-center gap-1.5 ${
            voiceTab === 'ai_agent'
              ? 'border-[#00a884] text-[#008069]'
              : 'border-transparent text-[#8696a0] hover:text-[#54656f]'
          }`}
        >
          AI Realtime Assistant (ChatGPT Stream)
        </button>
      </div>

      {voiceTab === 'workflows' && (
        <div className="space-y-6 max-w-4xl animate-in fade-in duration-300">
          {/* Main header block / status card */}
          <div className="bg-white rounded-lg border border-[#e9edef] p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Phone size={20} className="text-[#00a884]" />
                <h2 className="text-base font-bold text-[#111b21]">Workflows Dashboard</h2>
              </div>
              {!selectedWorkflow && (
                <button
                  onClick={() => {
                    setNewWorkflowName('')
                    setNewWorkflowDescription('')
                    setShowAddWorkflowModal(true)
                  }}
                  className="bg-[#00a884] hover:bg-[#008069] text-white px-4 py-2 rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Plus size={13} />
                  <span>Create Workflow</span>
                </button>
              )}
            </div>

            <div className="bg-[#e7f7f4] border border-[#00a884]/20 rounded-lg p-4 mb-4 select-none">
              <p className="text-xs text-[#008069] font-bold">
                Voice Call Setup Instructions:
              </p>
              <p className="text-[11px] text-[#008069] mt-1.5 leading-relaxed font-semibold">
                Configure incoming calls to your gateway voice number to point to the following webhook URL. Only <strong>one active workflow</strong> is allowed at a time. Active calls will dynamically follow the active tree.
              </p>
              <div className="font-mono text-[10px] bg-white p-2.5 rounded-lg mt-2.5 border border-[#00a884]/10 select-all break-all text-[#54656f] font-semibold">
                {webhookUrl || 'loading...'}
              </div>
            </div>

            {/* If selectedWorkflow is null, show workflows list. Otherwise, show step flow editor */}
            {!selectedWorkflow ? (
              <div>
                {loadingWorkflows ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin text-[#00a884]" />
                  </div>
                ) : workflows.length === 0 ? (
                  <div className="p-12 text-center text-[#667781] border border-dashed border-[#e9edef] rounded-lg bg-[#f8f9fa] mt-4">
                    <Phone size={36} className="text-[#e9edef] mx-auto mb-3 animate-pulse" />
                    <p className="text-xs font-bold text-[#111b21]">No voice workflows configured</p>
                    <p className="text-[10px] font-semibold text-[#667781] mt-1">Start by creating a workflow using the button above.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-[#e9edef] rounded-lg mt-4">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[#e9edef] bg-[#f8f9fa] text-[9px] font-black uppercase tracking-wider text-[#667781]">
                          <th className="px-6 py-3">Workflow Name & Description</th>
                          <th className="px-6 py-3">Steps</th>
                          <th className="px-6 py-3 text-center">Status</th>
                          <th className="px-6 py-3">Last Updated</th>
                          <th className="px-6 py-3 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workflows.map((wf) => (
                          <tr key={wf.id} className="border-b border-[#f5f6f6] last:border-b-0 hover:bg-[#f8f9fa] transition-colors">
                            <td className="px-6 py-4 font-bold text-[#111b21] max-w-xs">
                              <p className="truncate text-xs">{wf.name}</p>
                              {wf.description && (
                                <p className="text-[10px] text-[#667781] font-semibold leading-relaxed mt-0.5 whitespace-normal">
                                  {wf.description}
                                </p>
                              )}
                            </td>
                            <td className="px-6 py-4 text-[#54656f] font-bold text-[10px]">
                              <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                                {wf.steps?.length || 0} steps
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => handleToggleActive(wf.id, wf.is_active)}
                                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                    wf.is_active ? 'bg-[#00a884]' : 'bg-[#e9edef]'
                                  }`}
                                >
                                  <span
                                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                      wf.is_active ? 'translate-x-4' : 'translate-x-0'
                                    }`}
                                  />
                                </button>
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${wf.is_active ? 'text-[#008069]' : 'text-[#8696a0]'}`}>
                                  {wf.is_active ? 'Active' : 'Inactive'}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-[#8696a0] font-semibold text-[10px]">
                              {new Date(wf.updated_at).toLocaleDateString()} {new Date(wf.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="px-6 py-4 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => {
                                    setSelectedWorkflow(wf)
                                    setEditWorkflowSteps(wf.steps || [])
                                  }}
                                  className="px-2.5 py-1 border border-[#e9edef] text-[#008069] hover:bg-[#e7f7f4] hover:border-[#00a884] rounded text-[10px] font-bold transition-all cursor-pointer shrink-0"
                                >
                                  Edit Flow
                                </button>
                                <button
                                  onClick={() => handleDeleteWorkflow(wf.id)}
                                  className="p-1 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                                  title="Delete Workflow"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-6 mt-4">
                {/* Editor Header */}
                <div className="flex items-center justify-between pb-4 border-b border-[#e9edef] animate-in slide-in-from-top-2 duration-300">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setSelectedWorkflow(null)}
                      className="p-1.5 text-[#54656f] hover:bg-[#f0f2f5] rounded-full transition-colors cursor-pointer"
                      title="Back to workflows"
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-[#111b21]">{selectedWorkflow.name}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                          selectedWorkflow.is_active 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                            : 'bg-gray-50 text-gray-500 border-gray-100'
                        }`}>
                          {selectedWorkflow.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      {selectedWorkflow.description && (
                        <p className="text-[10px] text-[#667781] font-semibold mt-0.5">{selectedWorkflow.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedWorkflow(null)}
                      className="px-4 py-2 border border-[#e9edef] text-[#54656f] hover:bg-[#f0f2f5] rounded-lg text-xs font-bold transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveWorkflowSteps}
                      disabled={savingWorkflow}
                      className="bg-[#00a884] hover:bg-[#008069] disabled:bg-[#a5e1d5] text-white px-4 py-2 rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      {savingWorkflow ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      <span>Save Changes</span>
                    </button>
                  </div>
                </div>

                {/* Add Step Action Bar */}
                <div className="flex flex-wrap items-center gap-2.5 p-3.5 bg-[#f8f9fa] rounded-lg border border-[#e9edef] select-none">
                  <span className="text-[10px] font-black text-[#54656f] uppercase tracking-wider mr-1.5">Add step:</span>
                  <button onClick={() => handleAddStep('say')} className="px-2.5 py-1.5 bg-white border border-[#e9edef] hover:border-[#00a884] text-[#008069] hover:bg-emerald-50 rounded-lg text-[10px] font-bold cursor-pointer transition-all shadow-sm">
                    + Say Prompt (TTS)
                  </button>
                  <button onClick={() => handleAddStep('gather')} className="px-2.5 py-1.5 bg-white border border-[#e9edef] hover:border-[#00a884] text-[#008069] hover:bg-emerald-50 rounded-lg text-[10px] font-bold cursor-pointer transition-all shadow-sm">
                    + Interactive Menu (Gather)
                  </button>
                  <button onClick={() => handleAddStep('dial')} className="px-2.5 py-1.5 bg-white border border-[#e9edef] hover:border-[#00a884] text-[#008069] hover:bg-emerald-50 rounded-lg text-[10px] font-bold cursor-pointer transition-all shadow-sm">
                    + Forward Call (Dial)
                  </button>
                  <button onClick={() => handleAddStep('record')} className="px-2.5 py-1.5 bg-white border border-[#e9edef] hover:border-[#00a884] text-[#008069] hover:bg-emerald-50 rounded-lg text-[10px] font-bold cursor-pointer transition-all shadow-sm">
                    + Voicemail (Record)
                  </button>
                  <button onClick={() => handleAddStep('hangup')} className="px-2.5 py-1.5 bg-white border border-[#e9edef] hover:border-[#00a884] text-[#008069] hover:bg-emerald-50 rounded-lg text-[10px] font-bold cursor-pointer transition-all shadow-sm">
                    + Hang Up
                  </button>
                </div>

                {/* Steps List */}
                {editWorkflowSteps.length === 0 ? (
                  <div className="py-12 text-center text-[#667781] border border-dashed border-[#e9edef] rounded-lg bg-white">
                    <Phone size={36} className="text-[#e9edef] mx-auto mb-3 animate-pulse" />
                    <p className="text-xs font-bold text-[#111b21]">No steps configured yet</p>
                    <p className="text-[10px] font-semibold mt-1">Add a step using the buttons above to build your interactive menu.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-1 select-none">
                      <span className="text-[10px] text-[#8696a0] font-black uppercase tracking-wider">Configure steps</span>
                      <span className="text-[10px] text-[#008069] bg-[#e7f7f4] border border-[#00a884]/15 px-2 py-0.5 rounded-full font-bold">
                        Note: The call always starts at step with ID: <code className="font-mono text-rose-600 font-bold px-0.5">start</code>
                      </span>
                    </div>
                    {editWorkflowSteps.map((step, idx) => (
                      <div key={idx} className="bg-white rounded-lg border border-[#e9edef] shadow-xs overflow-hidden transition-shadow hover:shadow-sm animate-in slide-in-from-bottom-2 duration-300">
                        {/* Card header */}
                        <div className="px-4 py-3 bg-[#f8f9fa] border-b border-[#e9edef] flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            {/* Step number badge */}
                            <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-[#e9edef] text-[#54656f] text-[10px] font-bold">
                              {idx + 1}
                            </span>
                            
                            {/* Step ID input */}
                            <div className="flex items-center gap-1.5 flex-1 max-w-[220px]">
                              <span className="text-[10px] text-[#667781] font-bold">ID:</span>
                              <input
                                type="text"
                                value={step.id}
                                onChange={e => handleUpdateStepField(idx, 'id', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                                placeholder="step_id"
                                className="px-2 py-1 bg-white border border-[#e9edef] focus:border-[#00a884] focus:outline-none rounded text-[11px] font-bold flex-1"
                              />
                            </div>

                            {/* Step Type badge */}
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider select-none ${
                              step.type === 'say' ? 'bg-purple-50 text-purple-700 border border-purple-100' :
                              step.type === 'gather' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                              step.type === 'dial' ? 'bg-blue-50 text-blue-700 border border-blue-100' :
                              step.type === 'record' ? 'bg-rose-50 text-rose-700 border border-rose-100' :
                              'bg-gray-50 text-gray-700 border border-gray-100'
                            }`}>
                              {step.type}
                            </span>

                            {/* Info text if it's the start step */}
                            {step.id === 'start' && (
                              <span className="text-[9px] text-[#008069] font-bold bg-[#e7f7f4] border border-[#00a884]/20 px-2 py-0.5 rounded-full select-none">
                                Entry Point
                              </span>
                            )}
                          </div>

                          {/* Delete step button */}
                          <button
                            onClick={() => handleDeleteStep(idx)}
                            className="p-1 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                            title="Delete step"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>

                        {/* Card body */}
                        <div className="p-4 space-y-3.5">
                          {/* Render inputs based on step type */}
                          {step.type === 'say' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-[10px] font-bold text-[#54656f] uppercase tracking-wider mb-1">
                                  Text Prompt (TTS)
                                </label>
                                <textarea
                                  rows={2.5}
                                  value={step.text || ''}
                                  onChange={e => handleUpdateStepField(idx, 'text', e.target.value)}
                                  placeholder="e.g. Welcome to our support hotline."
                                  className="w-full px-2.5 py-1.5 bg-white border border-[#e9edef] focus:border-[#00a884] focus:outline-none rounded text-xs font-semibold placeholder-[#8696a0] resize-none"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-[#54656f] uppercase tracking-wider mb-1">
                                  Next Step Route
                                </label>
                                <select
                                  value={step.next_step || ''}
                                  onChange={e => handleUpdateStepField(idx, 'next_step', e.target.value || null)}
                                  className="w-full px-2.5 py-1.5 bg-white border border-[#e9edef] focus:border-[#00a884] focus:outline-none rounded text-xs font-semibold text-[#54656f] cursor-pointer"
                                >
                                  <option value="">Hang Up (None)</option>
                                  {editWorkflowSteps.map((otherStep) => (
                                    otherStep.id !== step.id && (
                                      <option key={otherStep.id} value={otherStep.id}>
                                        {otherStep.id} ({otherStep.type})
                                      </option>
                                    )
                                  ))}
                                </select>
                                <p className="text-[9px] text-[#667781] mt-1.5 font-medium">After reading the TTS prompt, route the call to this step next.</p>
                              </div>
                            </div>
                          )}

                          {step.type === 'dial' && (
                            <div>
                              <label className="block text-[10px] font-bold text-[#54656f] uppercase tracking-wider mb-1">
                                Forward to Phone Number (E.164 format)
                              </label>
                              <input
                                type="text"
                                value={step.phoneNumber || ''}
                                onChange={e => handleUpdateStepField(idx, 'phoneNumber', e.target.value.trim())}
                                placeholder="e.g. +1234567890"
                                className="w-full max-w-sm px-2.5 py-1.5 bg-white border border-[#e9edef] focus:border-[#00a884] focus:outline-none rounded text-xs font-semibold placeholder-[#8696a0]"
                              />
                              <p className="text-[9px] text-[#667781] mt-1.5 font-medium">Include country code prefix (e.g. +1 for USA, +44 for UK).</p>
                            </div>
                          )}

                          {step.type === 'record' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-[10px] font-bold text-[#54656f] uppercase tracking-wider mb-1">
                                  Text Prompt before Voicemail
                                </label>
                                <textarea
                                  rows={2.5}
                                  value={step.text || ''}
                                  onChange={e => handleUpdateStepField(idx, 'text', e.target.value)}
                                  placeholder="e.g. Please leave your message after the tone. Press pound when finished."
                                  className="w-full px-2.5 py-1.5 bg-white border border-[#e9edef] focus:border-[#00a884] focus:outline-none rounded text-xs font-semibold placeholder-[#8696a0] resize-none"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-[#54656f] uppercase tracking-wider mb-1">
                                  Next Step Route (Optional)
                                </label>
                                <select
                                  value={step.next_step || ''}
                                  onChange={e => handleUpdateStepField(idx, 'next_step', e.target.value || null)}
                                  className="w-full px-2.5 py-1.5 bg-white border border-[#e9edef] focus:border-[#00a884] focus:outline-none rounded text-xs font-semibold text-[#54656f] cursor-pointer"
                                >
                                  <option value="">Hang Up (None)</option>
                                  {editWorkflowSteps.map((otherStep) => (
                                    otherStep.id !== step.id && (
                                      <option key={otherStep.id} value={otherStep.id}>
                                        {otherStep.id} ({otherStep.type})
                                      </option>
                                    )
                                  ))}
                                </select>
                                <p className="text-[9px] text-[#667781] mt-1.5 font-medium">After caller finishes recording, redirect call to this step.</p>
                              </div>
                            </div>
                          )}

                          {step.type === 'gather' && (
                            <div className="space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="md:col-span-2">
                                  <label className="block text-[10px] font-bold text-[#54656f] uppercase tracking-wider mb-1">
                                    Interactive Menu Prompt (TTS)
                                  </label>
                                  <textarea
                                    rows={2.5}
                                    value={step.prompt || ''}
                                    onChange={e => handleUpdateStepField(idx, 'prompt', e.target.value)}
                                    placeholder="e.g. Press 1 for Sales, or press 2 for Support."
                                    className="w-full px-2.5 py-1.5 bg-white border border-[#e9edef] focus:border-[#00a884] focus:outline-none rounded text-xs font-semibold placeholder-[#8696a0] resize-none"
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[10px] font-bold text-[#54656f] uppercase tracking-wider mb-1">
                                      Num Digits
                                    </label>
                                    <input
                                      type="number"
                                      min={1}
                                      max={10}
                                      value={step.numDigits || 1}
                                      onChange={e => handleUpdateStepField(idx, 'numDigits', e.target.value)}
                                      className="w-full px-2.5 py-1.5 bg-white border border-[#e9edef] focus:border-[#00a884] focus:outline-none rounded text-xs font-semibold"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-bold text-[#54656f] uppercase tracking-wider mb-1">
                                      Timeout (sec)
                                    </label>
                                    <input
                                      type="number"
                                      min={1}
                                      max={30}
                                      value={step.timeout || 5}
                                      onChange={e => handleUpdateStepField(idx, 'timeout', e.target.value)}
                                      className="w-full px-2.5 py-1.5 bg-white border border-[#e9edef] focus:border-[#00a884] focus:outline-none rounded text-xs font-semibold"
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Keypress Digit Routing */}
                              <div className="border border-[#e9edef] rounded-lg overflow-hidden bg-white">
                                <div className="px-3.5 py-2 bg-[#f8f9fa] border-b border-[#e9edef] flex items-center justify-between select-none">
                                  <span className="text-[10px] font-bold text-[#111b21] uppercase tracking-wider">Keypress Routing Setup</span>
                                  <span className="text-[9px] text-[#667781] font-semibold">Map digit inputs to target steps</span>
                                </div>
                                <div className="p-3 space-y-2">
                                  {/* Existing routes */}
                                  {Object.entries(step.routes || {}).length === 0 ? (
                                    <p className="text-[10px] text-[#8696a0] italic py-1 font-semibold select-none">No keypress routes configured. Incoming digit entries will fall back to timeout.</p>
                                  ) : (
                                    <div className="space-y-2">
                                      {Object.entries(step.routes || {}).map(([digit, targetStepId]: [string, any]) => (
                                        <div key={digit} className="flex items-center gap-2 bg-[#f8f9fa] p-2 rounded-lg border border-[#e9edef] animate-in zoom-in-95 duration-200">
                                          <span className="font-mono text-xs font-black text-[#008069] bg-white px-2.5 py-0.5 rounded border border-[#e9edef] select-none">
                                            Key {digit}
                                          </span>
                                          <span className="text-[10px] text-[#8696a0] font-bold select-none">routes to</span>
                                          <select
                                            value={targetStepId || ''}
                                            onChange={e => handleUpdateGatherRoute(idx, digit, e.target.value)}
                                            className="px-2.5 py-1 bg-white border border-[#e9edef] focus:border-[#00a884] focus:outline-none rounded text-[11px] font-semibold text-[#54656f] flex-1 max-w-[220px] cursor-pointer"
                                          >
                                            <option value="">Select target step...</option>
                                            {editWorkflowSteps.map((otherStep) => (
                                              otherStep.id !== step.id && (
                                                <option key={otherStep.id} value={otherStep.id}>
                                                  {otherStep.id} ({otherStep.type})
                                                </option>
                                              )
                                            ))}
                                          </select>
                                          <button
                                            onClick={() => handleUpdateGatherRoute(idx, digit, null)}
                                            className="p-1 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer ml-auto"
                                            title="Remove route"
                                          >
                                            <X size={12} />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Add Route selector */}
                                  <div className="flex items-center gap-2.5 pt-3 border-t border-[#e9edef] mt-2 select-none">
                                    <span className="text-[10px] font-bold text-[#54656f]">Add Route for Key:</span>
                                    <select
                                      id={`add-digit-${idx}`}
                                      className="px-2 py-1 bg-white border border-[#e9edef] rounded text-[11px] font-bold text-[#54656f] cursor-pointer"
                                      defaultValue="1"
                                    >
                                      {['1','2','3','4','5','6','7','8','9','0','*','#'].map(d => (
                                        <option key={d} value={d}>{d}</option>
                                      ))}
                                    </select>
                                    <span className="text-[10px] font-bold text-[#54656f]">to Step:</span>
                                    <select
                                      id={`add-target-${idx}`}
                                      className="px-2.5 py-1 bg-white border border-[#e9edef] rounded text-[11px] font-bold text-[#54656f] cursor-pointer"
                                      defaultValue=""
                                    >
                                      <option value="">Select...</option>
                                      {editWorkflowSteps.map((otherStep) => (
                                        otherStep.id !== step.id && (
                                          <option key={otherStep.id} value={otherStep.id}>
                                            {otherStep.id} ({otherStep.type})
                                          </option>
                                        )
                                      ))}
                                    </select>
                                    <button
                                      onClick={() => {
                                        const digitEl = document.getElementById(`add-digit-${idx}`) as HTMLSelectElement
                                        const targetEl = document.getElementById(`add-target-${idx}`) as HTMLSelectElement
                                        const digit = digitEl.value
                                        const target = targetEl.value
                                        if (target) {
                                          handleUpdateGatherRoute(idx, digit, target)
                                          targetEl.value = "" // reset
                                        } else {
                                          showNotification('error', 'Please select a target step to route to.', 'Error Adding Route')
                                        }
                                      }}
                                      className="px-3 py-1 bg-[#00a884] hover:bg-[#008069] text-white rounded text-[10px] font-bold transition-colors cursor-pointer shadow-xs"
                                    >
                                      Add Route
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {step.type === 'hangup' && (
                            <p className="text-[11px] text-[#667781] italic font-semibold select-none">This step will terminate the call. No additional configuration is required.</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Add Workflow Modal Backdrop */}
          {showAddWorkflowModal && (
            <div className="fixed inset-0 bg-[#111b21]/40 backdrop-blur-xs flex items-center justify-center z-50 animate-in fade-in duration-200">
              <div className="bg-white rounded-xl border border-[#e9edef] shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-4 select-none">
                  <h3 className="text-sm font-bold text-[#111b21]">Create Voice Workflow</h3>
                  <button onClick={() => setShowAddWorkflowModal(false)} className="text-[#8696a0] hover:text-[#54656f] p-1 rounded-full hover:bg-[#f0f2f5] cursor-pointer transition-colors">
                    <X size={16} />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5 select-none">
                      Workflow Name
                    </label>
                    <input
                      type="text"
                      value={newWorkflowName}
                      onChange={e => setNewWorkflowName(e.target.value)}
                      placeholder="e.g. Standard IVR Greeting"
                      className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5 select-none">
                      Description (Optional)
                    </label>
                    <textarea
                      rows={3}
                      value={newWorkflowDescription}
                      onChange={e => setNewWorkflowDescription(e.target.value)}
                      placeholder="e.g. Greeting menu with support redirect and voicemail options."
                      className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] resize-none"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-6 select-none">
                  <button
                    onClick={() => setShowAddWorkflowModal(false)}
                    className="px-4 py-2 border border-[#e9edef] text-[#54656f] hover:bg-[#f0f2f5] rounded-lg text-xs font-bold transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateWorkflow}
                    disabled={actionLoading || !newWorkflowName.trim()}
                    className="bg-[#00a884] hover:bg-[#008069] disabled:bg-[#a5e1d5] text-white px-4 py-2 rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    {actionLoading && <Loader2 size={13} className="animate-spin" />}
                    <span>Create</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {voiceTab === 'ai_agent' && (
        <div className="space-y-6 max-w-4xl animate-in fade-in duration-300">
          
          {/* Webhook Instruction Banner */}
          <div className="bg-[#e7f7f4] border border-[#00a884]/20 rounded-lg p-4 select-none">
            <p className="text-xs text-[#008069] font-bold">
              AI Realtime Voice Assistant Integration Instructions:
            </p>
            <p className="text-[11px] text-[#008069] mt-1.5 leading-relaxed font-semibold">
              To route calls through our AI real-time voice assistant, configure your voice number voice webhook to point to the following URL (exposing port 5050 locally via ngrok):
            </p>
            <div className="font-mono text-[10px] bg-white p-2.5 rounded-lg mt-2.5 border border-[#00a884]/10 select-all break-all text-[#54656f] font-semibold">
              {webhookUrl ? webhookUrl.replace('/api/webhooks/voice', ':5050/incoming-call') : 'http://localhost:5050/incoming-call'}
            </div>
            <p className="text-[10px] text-[#008069] mt-2 font-medium">
              Start the WebSocket proxy server locally: <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-[#00a884]/10 text-rose-600 font-bold select-all">node scripts/live-stream-server.js</code>
            </p>
          </div>

          {/* Settings Form */}
          <div className="bg-white rounded-lg border border-[#e9edef] p-6 shadow-sm">
            <h2 className="text-base font-bold text-[#111b21] mb-4">AI Agent System Configuration</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5 select-none">
                  Custom System Prompt (AI Personality & Guardrails)
                </label>
                <textarea
                  rows={4}
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  placeholder="e.g. You are a helpful booking assistant. Be concise. Ask the caller for their full name, email, and the service they wish to book. Once collected, invoke the save_variables function to finish."
                  className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0] resize-y"
                />
                <p className="text-[10px] text-[#667781] mt-1.5 font-medium select-none">
                  This custom prompt acts as the system instructions for the GPT-4o Realtime voice assistant model.
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#54656f] uppercase tracking-wider mb-1.5 select-none">
                  Output Variables Schema (Comma separated)
                </label>
                <input
                  type="text"
                  value={aiVariables}
                  onChange={e => setAiVariables(e.target.value)}
                  placeholder="e.g. name, email, booking_date, service_type"
                  className="w-full px-3.5 py-2.5 bg-white border border-[#e9edef] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold placeholder-[#8696a0]"
                />
                <p className="text-[10px] text-[#667781] mt-1.5 font-medium select-none">
                  Define what variables the AI assistant should gather from the call conversation (the model will submit these in JSON via tool choice function calls).
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleSaveAiSettings}
                  disabled={savingAiSettings || !aiPrompt.trim()}
                  className="bg-[#00a884] hover:bg-[#008069] disabled:bg-[#a5e1d5] text-white px-4 py-2.5 rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                >
                  {savingAiSettings ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  <span>Save AI Settings</span>
                </button>
              </div>
            </div>
          </div>

          {/* Calls Log Table */}
          <div className="bg-white rounded-lg border border-[#e9edef] shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#e9edef] bg-[#f8f9fa] flex items-center justify-between select-none">
              <h3 className="text-sm font-bold text-[#111b21]">Live Voice Stream Sessions & Extracted Data</h3>
              <button
                onClick={() => user?.organization_id && loadAiCalls(user.organization_id)}
                disabled={loadingAiCalls}
                className="text-[10px] font-bold text-[#008069] hover:underline cursor-pointer flex items-center gap-1.5"
              >
                {loadingAiCalls && <Loader2 size={10} className="animate-spin" />}
                Refresh Logs
              </button>
            </div>

            {loadingAiCalls ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-[#00a884]" />
              </div>
            ) : aiCalls.length === 0 ? (
              <div className="p-12 text-center text-[#667781]">
                <Phone size={36} className="text-[#e9edef] mx-auto mb-3 animate-pulse" />
                <p className="text-xs font-bold text-[#111b21]">No real-time call sessions recorded yet</p>
                <p className="text-[10px] font-semibold text-[#667781] mt-1">Incoming calls routed to the live stream server will show here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#e9edef] bg-[#f8f9fa] text-[9px] font-black uppercase tracking-wider text-[#667781] select-none">
                      <th className="px-6 py-3">Call SID</th>
                      <th className="px-6 py-3">Caller Number</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Extracted JSON Variables</th>
                      <th className="px-6 py-3">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiCalls.map((call) => (
                      <tr key={call.id} className="border-b border-[#f5f6f6] last:border-b-0 hover:bg-[#f8f9fa] transition-colors">
                        <td className="px-6 py-3.5 font-mono text-[10px] text-[#54656f]">
                          {call.call_sid.substring(0, 12)}...
                        </td>
                        <td className="px-6 py-3.5 font-bold text-[#111b21]">
                          {call.phone_number || 'Unknown'}
                        </td>
                        <td className="px-6 py-3.5 select-none">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                            call.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                            call.status === 'active' ? 'bg-blue-50 text-blue-700 border-blue-100 animate-pulse' :
                            call.status === 'ended' ? 'bg-slate-50 text-slate-600 border-slate-200' :
                            'bg-gray-50 text-gray-500 border-gray-100'
                          }`}>
                            {call.status}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 max-w-sm">
                          {Object.keys(call.extracted_variables || {}).length === 0 ? (
                            <span className="text-[10px] text-[#8696a0] italic font-semibold">No data captured yet</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {Object.entries(call.extracted_variables || {}).map(([key, val]) => (
                                <span key={key} className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#e7f7f4] text-[#008069] border border-[#00a884]/15 font-bold text-[10px]">
                                  <span className="opacity-60 mr-1">{key}:</span>{String(val)}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-3.5 text-[#8696a0] font-semibold text-[10px]">
                          {new Date(call.created_at).toLocaleDateString()} {new Date(call.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  Smartphone,
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  Copy,
  Check,
  FileCode2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Calendar,
  List,
  Type,
  AlignLeft,
  CheckSquare,
  HelpCircle,
  X,
  ClipboardList,
  Loader2,
  CheckCircle2,
} from 'lucide-react'
import { MetaFlowScreen, MetaFormField } from '@/lib/flows/flow-types'
import { compileMetaFlowJSON } from '@/lib/flows/meta-flows-spec'
import { useAlert } from '@/lib/dialog-context'

// The categories Meta accepts for a WhatsApp Flow
const FORM_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'LEAD_GENERATION', label: 'Lead generation' },
  { value: 'APPOINTMENT_BOOKING', label: 'Appointment booking' },
  { value: 'CONTACT_US', label: 'Contact us' },
  { value: 'CUSTOMER_SUPPORT', label: 'Customer support' },
  { value: 'SURVEY', label: 'Survey' },
  { value: 'SIGN_UP', label: 'Sign up' },
  { value: 'SIGN_IN', label: 'Sign in' },
  { value: 'OTHER', label: 'Other' },
]

// Elements that only display text: they have no answer, so no key, "required" or hint
const DISPLAY_ONLY_TYPES = ['TextCaption', 'TextSubheading', 'TextBody']

export default function NativeFlowDesignerPage() {
  const alert = useAlert()
  const params = useParams()
  const flowId = params?.flowId as string

  // Flow State
  const [nativeFlow, setNativeFlow] = useState<any>(null)
  const [flowName, setFlowName] = useState('')
  const [status, setStatus] = useState('DRAFT')
  const [category, setCategory] = useState('LEAD_GENERATION')
  const [screens, setScreens] = useState<MetaFlowScreen[]>([])
  const [activeScreenIndex, setActiveScreenIndex] = useState(0)

  // Loading & Saving
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [saveError, setSaveError] = useState('')
  const [submissions, setSubmissions] = useState<any[]>([])
  const isPublished = status === 'PUBLISHED' && Boolean(nativeFlow?.flow_id_meta)
  const [copiedJson, setCopiedJson] = useState(false)
  const [showJsonModal, setShowJsonModal] = useState(false)

  // Mobile Preview Interactive State
  const [previewValues, setPreviewValues] = useState<Record<string, any>>({})
  const [previewSubmittedData, setPreviewSubmittedData] = useState<any | null>(null)

  // Load Native Flow
  useEffect(() => {
    async function loadFlow() {
      if (!flowId) return
      setLoading(true)
      try {
        const res = await fetch(`/api/flows/native/${flowId}`)
        if (!res.ok) throw new Error('not found')
        const data = await res.json()
        const f = data.flow

        setNativeFlow(f)
        setSubmissions(data.submissions || [])
        setFlowName(f.name)
        setStatus(f.flow_id_meta ? f.status : 'DRAFT')
        // A category Meta does not accept (from an older template) falls back to "Other"
        setCategory(FORM_CATEGORIES.some((item) => item.value === f.categories?.[0]) ? f.categories[0] : 'OTHER')
        setScreens(f.screens || [])
      } catch (err) {
        console.error('Failed to load native flow:', err)
        setLoadFailed(true)
      } finally {
        setLoading(false)
      }
    }
    loadFlow()
  }, [flowId])

  // Save Native Flow
  const saveFlow = async (action?: 'validate' | 'publish') => {
    if (!flowId) return
    setSaving(true)
    setSaveError('')
    setFeedback('')
    try {
      const res = await fetch(`/api/flows/native/${flowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: flowName,
          action,
          categories: [category],
          screens,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error([data.error, ...(data.validationErrors || []).map((error: any) => typeof error === 'string' ? error : error.message)].filter(Boolean).join('\n'))
      setNativeFlow(data.flow)
      setStatus(data.flow.status)
      setDirty(false)
      setFeedback(action === 'publish' ? 'Published on WhatsApp. You can now activate a workflow using this form.' : action === 'validate' ? 'Meta accepted this draft. Review the form before publishing.' : 'Draft saved.')
    } catch (err: any) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Every edit to the form goes through here so unsaved work is tracked
  const changeScreens = (next: MetaFlowScreen[]) => {
    setScreens(next)
    setDirty(true)
    setFeedback('')
  }

  // Compile continuously so mistakes show up while editing, not only when Meta rejects the form
  const compileError = useMemo(() => {
    try {
      compileMetaFlowJSON(screens)
      return ''
    } catch (error: any) {
      return error.message as string
    }
  }, [screens])

  // Warn before leaving with unsaved work
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Active Screen
  const currentScreen: MetaFlowScreen | undefined = screens[activeScreenIndex]

  // Add Screen
  const addScreen = () => {
    if (isPublished || screens.length >= 10) return
    const usedIds = new Set(screens.map((screen) => screen.id))
    let suffix = String.fromCharCode(65 + screens.length) // screen ids may only contain letters and underscores
    while (usedIds.has(`SCREEN_${suffix}`)) suffix += 'X'
    const usedNames = new Set(screens.flatMap((screen) => (screen.layout?.children || []).map((field) => field.name)))
    let nameNumber = screens.length + 1
    while (usedNames.has(`answer_${nameNumber}`)) nameNumber++

    changeScreens([
      ...screens,
      {
        id: `SCREEN_${suffix}`,
        title: `Step ${screens.length + 1}`,
        layout: {
          type: 'SingleColumnLayout',
          children: [{ id: `field_${Date.now().toString(36)}`, type: 'TextInput', label: 'Your answer', name: `answer_${nameNumber}`, required: true }],
        },
      },
    ])
    setActiveScreenIndex(screens.length)
  }

  // Delete Screen
  const deleteScreen = (idx: number) => {
    if (isPublished) return
    if (screens.length <= 1) {
      alert({ title: 'Cannot delete this screen', message: 'A WhatsApp form must have at least one screen.' })
      return
    }
    changeScreens(screens.filter((_, i) => i !== idx))
    setActiveScreenIndex((current) => Math.max(0, current >= idx ? current - 1 : current))
  }

  const updateScreen = (updates: Partial<MetaFlowScreen>) => {
    changeScreens(screens.map((screen, i) => (i === activeScreenIndex ? { ...screen, ...updates } : screen)))
  }

  // Add Component Field to Current Screen
  const addField = (type: MetaFormField['type']) => {
    if (!currentScreen || isPublished) return
    const usedNames = new Set(screens.flatMap((screen) => (screen.layout?.children || []).map((field) => field.name)))
    const base = { TextInput: 'text', TextArea: 'details', Dropdown: 'choice', RadioGroup: 'option', CheckboxGroup: 'selection', DatePicker: 'date', OptIn: 'consent' }[type as string] || 'field'
    let name = base
    for (let n = 2; usedNames.has(name); n++) name = `${base}_${n}`

    const displayOnly = DISPLAY_ONLY_TYPES.includes(type)
    const newField: MetaFormField = {
      id: `field_${Date.now().toString(36)}`,
      type,
      label: displayOnly ? 'Add a short instruction here.' : type === 'OptIn' ? 'I agree to be contacted on WhatsApp.' : 'New question',
      name,
      required: !displayOnly,
    }

    if (type === 'Dropdown' || type === 'RadioGroup' || type === 'CheckboxGroup') {
      newField.options = [
        { id: 'option_1', title: 'Option 1' },
        { id: 'option_2', title: 'Option 2' },
      ]
    }

    updateScreenChildren([...(currentScreen.layout?.children || []), newField])
  }

  // Move a field up or down within the screen
  const moveField = (fieldIndex: number, direction: -1 | 1) => {
    if (!currentScreen || isPublished) return
    const children = [...(currentScreen.layout?.children || [])]
    const target = fieldIndex + direction
    if (target < 0 || target >= children.length) return
    ;[children[fieldIndex], children[target]] = [children[target], children[fieldIndex]]
    updateScreenChildren(children)
  }

  // Update Field
  const updateField = (fieldIndex: number, updates: Partial<MetaFormField>) => {
    if (!currentScreen || isPublished) return
    const updatedChildren = (currentScreen.layout?.children || []).map((f, i) =>
      i === fieldIndex ? { ...f, ...updates } : f
    )
    updateScreenChildren(updatedChildren)
  }

  // Delete Field
  const deleteField = (fieldIndex: number) => {
    if (!currentScreen || isPublished) return
    const updatedChildren = (currentScreen.layout?.children || []).filter((_, i) => i !== fieldIndex)
    updateScreenChildren(updatedChildren)
  }

  // Helper: update current screen children
  const updateScreenChildren = (children: MetaFormField[]) => {
    const updatedScreens = screens.map((s, i) => {
      if (i !== activeScreenIndex) return s
      return {
        ...s,
        layout: {
          ...(s.layout || { type: 'SingleColumnLayout' }),
          children,
        },
      }
    })
    changeScreens(updatedScreens)
  }

  // Compiled JSON
  const getCompiledJson = () => {
    try {
      return compileMetaFlowJSON(screens)
    } catch (e: any) {
      return { error: e.message }
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-[#0c1317] text-slate-900 dark:text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-indigo-500/20 border-t-indigo-500 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Smartphone className="w-6 h-6 text-indigo-500 dark:text-indigo-400" />
            </div>
          </div>
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Loading Screen Designer...</span>
        </div>
      </div>
    )
  }

  if (loadFailed) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-[#0c1317] p-6">
        <div className="text-center space-y-3">
          <Smartphone className="w-10 h-10 mx-auto text-slate-400" />
          <h1 className="text-base font-bold text-slate-900 dark:text-white">This form could not be opened</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">It may have been deleted, or you may not have access to it.</p>
          <Link href="/dashboard/flows" className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#008069] hover:bg-[#006d59] text-white text-xs font-bold">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to flows
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-[#0a0f12] text-slate-900 dark:text-slate-100 overflow-hidden font-sans">
      {/* Top Header */}
      <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#11181c] px-4 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/flows"
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>

          <div className="flex items-center gap-2">
            <span className="p-1 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
              <Smartphone className="w-4 h-4" />
            </span>
            <input
              type="text"
              value={flowName}
              disabled={isPublished}
              aria-label="Form name"
              maxLength={120}
              onChange={(e) => {
                setFlowName(e.target.value)
                setDirty(true)
              }}
              className="bg-transparent font-bold text-sm tracking-tight text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800/40 px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <select
            value={category}
            disabled={isPublished}
            aria-label="Form category"
            title="Category shown to Meta when the form is reviewed"
            onChange={(e) => {
              setCategory(e.target.value)
              setDirty(true)
            }}
            className="hidden lg:block text-xs font-semibold px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
          >
            {FORM_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          {isPublished ? (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-xs font-bold shadow-2xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Published on WhatsApp</span>
            </div>
          ) : nativeFlow?.flow_id_meta ? (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              <span>Draft on Meta</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              <span>{dirty ? 'Unsaved changes' : 'Draft'}</span>
            </div>
          )}

          {!isPublished && <>
            <button type="button" disabled={saving || Boolean(compileError)} title={compileError ? 'Fix the problem shown below first' : 'Uploads a draft so Meta can check it. Nothing goes live.'} onClick={() => saveFlow('validate')} className="text-xs px-3 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors font-medium cursor-pointer disabled:cursor-not-allowed">Check with Meta</button>
            <button type="button" disabled={saving || Boolean(compileError)} title={compileError ? 'Fix the problem shown below first' : 'A published form can no longer be edited'} onClick={() => saveFlow('publish')} className="text-xs px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium cursor-pointer disabled:cursor-not-allowed">Publish</button>
          </>}
          <button
            onClick={() => setShowJsonModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20 text-xs font-semibold shadow-sm transition-all"
          >
            <FileCode2 className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">View JSON</span>
          </button>

          <Link
            href={`/dashboard/flows/submissions?flowId=${flowId}&name=${encodeURIComponent(flowName)}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20 text-xs font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            <span>Responses</span>
          </Link>

          <button
            onClick={() => saveFlow()}
            disabled={saving || isPublished || !dirty}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#008069] hover:bg-[#00705c] text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50 cursor-pointer disabled:cursor-default"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>{saving ? 'Saving…' : 'Save draft'}</span>
          </button>
        </div>
      </header>

      {/* Meta Approval & Status Banner */}
      {isPublished && !saveError && !feedback && (
        <div className="px-5 py-2.5 text-xs bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-b border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-bold">Published.</span>
            <span>This form is live and can no longer be edited. To change it, create a new form.</span>
          </div>
          {nativeFlow?.flow_id_meta && (
            <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-900/60 px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-700 shrink-0 ml-3">
              Meta Flow ID: {nativeFlow.flow_id_meta}
            </span>
          )}
        </div>
      )}

      {(saveError || feedback) && <div role={saveError ? 'alert' : 'status'} className={`px-5 py-3 text-xs whitespace-pre-wrap border-b ${saveError ? 'bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-200 border-rose-200 dark:border-rose-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'}`}>
        {saveError || feedback}
      </div>}
      {compileError && !isPublished && (
        <div role="alert" className="px-5 py-2.5 text-xs font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border-b border-amber-200 dark:border-amber-800/60 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>Fix this before publishing: {compileError}</span>
        </div>
      )}
      {submissions.length > 0 && <div className="px-5 py-2 text-xs bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <span className="text-slate-600 dark:text-slate-300">{submissions.length} recent response(s)</span>
        <Link
          href={`/dashboard/flows/submissions?flowId=${flowId}&name=${encodeURIComponent(flowName)}`}
          className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-semibold hover:underline"
        >
          <ClipboardList className="w-3 h-3" />
          View All Responses
          <ChevronRight className="w-3 h-3" />
        </Link>
      </div>}
      {/* Main Builder Grid */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Screens List & Component Palette */}
        <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#11181c] p-4 flex flex-col justify-between overflow-y-auto z-10">
          <div className="space-y-5">
            {/* Screens List */}
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Screens</span>
                <button
                  type="button"
                  onClick={addScreen}
                  disabled={isPublished || screens.length >= 10}
                  title={screens.length >= 10 ? 'A form can have at most 10 screens' : undefined}
                  className="p-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-600 dark:text-indigo-300 text-xs flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </div>

              <div className="mt-2 space-y-1.5">
                {screens.map((screen, idx) => (
                  <div
                    key={idx}
                    onClick={() => setActiveScreenIndex(idx)}
                    className={`p-2 rounded-xl text-xs flex items-center justify-between cursor-pointer border transition-all ${
                      idx === activeScreenIndex
                        ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-500/50 text-indigo-700 dark:text-indigo-200 font-semibold'
                        : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-800 text-[10px] flex items-center justify-center font-mono text-slate-600 dark:text-slate-400">
                        {idx + 1}
                      </span>
                      <span className="truncate max-w-[120px]">{screen.title}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      {idx === screens.length - 1 && (
                        <span title="The last screen shows the Submit button" className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold">
                          Submit
                        </span>
                      )}
                      {screens.length > 1 && !isPublished && (
                        <button
                          type="button"
                          aria-label={`Delete screen ${screen.title}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteScreen(idx)
                          }}
                          className="p-1 text-slate-400 dark:text-slate-500 hover:text-rose-500 dark:hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Component Palette */}
            <div>
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide block pb-2 border-b border-slate-200 dark:border-slate-800">
                Add Field
              </span>
              <div className="mt-2 space-y-1.5">
                {[
                  { type: 'TextInput', label: 'Short answer', icon: Type },
                  { type: 'TextArea', label: 'Long answer', icon: AlignLeft },
                  { type: 'Dropdown', label: 'Dropdown', icon: List },
                  { type: 'RadioGroup', label: 'Single choice', icon: CheckSquare },
                  { type: 'CheckboxGroup', label: 'Multiple choice', icon: CheckSquare },
                  { type: 'DatePicker', label: 'Date', icon: Calendar },
                  { type: 'OptIn', label: 'Consent checkbox', icon: Check },
                  { type: 'TextCaption', label: 'Instruction text', icon: HelpCircle },
                ].map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.type}
                      type="button"
                      disabled={isPublished}
                      onClick={() => addField(item.type as any)}
                      className="w-full text-left p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/50 text-xs flex items-center gap-2.5 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all group cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Icon className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 group-hover:scale-110 transition-transform" />
                      <span>{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </aside>

        {/* Center Column: Screen Form Designer */}
        <fieldset disabled={isPublished} className="flex-1 min-w-0 p-6 overflow-y-auto bg-slate-100 dark:bg-[#0c1216]">
          {currentScreen ? (
            <div className="max-w-2xl mx-auto space-y-5">
              {/* Screen Metadata */}
              <div className="p-4 rounded-2xl bg-white dark:bg-[#11181c] border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-bold text-sm text-slate-700 dark:text-slate-200">Screen {activeScreenIndex + 1} of {screens.length}</h3>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {activeScreenIndex === screens.length - 1 ? 'Last screen: shows the Submit button' : 'Shows a Continue button to the next screen'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="screen-title" className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      <span>Screen title</span>
                      <span className={`font-normal tabular-nums ${currentScreen.title.length > 30 ? 'text-rose-600' : ''}`}>{currentScreen.title.length}/30</span>
                    </label>
                    <input
                      id="screen-title"
                      type="text"
                      value={currentScreen.title}
                      onChange={(e) => updateScreen({ title: e.target.value })}
                      className="w-full mt-1 p-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label htmlFor="screen-id" className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Screen ID</label>
                    <input
                      id="screen-id"
                      type="text"
                      value={currentScreen.id}
                      // Kept to capital letters and underscores, the format Meta expects
                      onChange={(e) => updateScreen({ id: e.target.value.toUpperCase().replace(/[^A-Z_]/g, '_') })}
                      className="w-full mt-1 p-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>

              {/* Fields List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Elements on this screen ({currentScreen.layout?.children?.length || 0})
                  </span>
                </div>

                {(currentScreen.layout?.children || []).map((field, fieldIdx) => (
                  <div
                    key={field.id || fieldIdx}
                    className="p-4 rounded-2xl bg-white dark:bg-[#161f26] border border-slate-200 dark:border-slate-800 space-y-3 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono uppercase bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 px-2 py-0.5 rounded font-bold">
                          {field.type}
                        </span>
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{field.label}</span>
                      </div>

                      <div className="flex items-center gap-0.5">
                        <button type="button" aria-label="Move up" title="Move up" disabled={fieldIdx === 0} onClick={() => moveField(fieldIdx, -1)} className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none cursor-pointer">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" aria-label="Move down" title="Move down" disabled={fieldIdx === (currentScreen.layout?.children?.length || 0) - 1} onClick={() => moveField(fieldIdx, 1)} className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none cursor-pointer">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${field.label}`}
                          onClick={() => deleteField(fieldIdx)}
                          className="p-1 rounded text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {DISPLAY_ONLY_TYPES.includes(field.type) ? (
                      <div>
                        <label className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Text shown to the customer</label>
                        <textarea
                          rows={2}
                          value={field.label}
                          onChange={(e) => updateField(fieldIdx, { label: e.target.value })}
                          className="w-full mt-1 p-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Question</label>
                            <input
                              type="text"
                              value={field.label}
                              onChange={(e) => updateField(fieldIdx, { label: e.target.value })}
                              className="w-full mt-1 p-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-500 dark:text-slate-400 font-medium" title="Used in flows as form.<key>, e.g. {{form.full_name}}">
                              Answer key
                            </label>
                            <input
                              type="text"
                              value={field.name}
                              // Keys are used in flows as form.<key>: keep them to letters, numbers and underscores
                              onChange={(e) => updateField(fieldIdx, { name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[0-9]+/, '') })}
                              className="w-full mt-1 p-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-slate-900 dark:text-slate-100"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 pt-1">
                          <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(field.required)}
                              onChange={(e) => updateField(fieldIdx, { required: e.target.checked })}
                              className="rounded accent-indigo-500"
                            />
                            Required
                          </label>

                          {(field.type === 'TextInput' || field.type === 'TextArea') && (
                            <input
                              type="text"
                              value={field.helper_text || ''}
                              aria-label="Hint shown under the field"
                              onChange={(e) => updateField(fieldIdx, { helper_text: e.target.value })}
                              placeholder="Hint shown under the field (optional)"
                              className="flex-1 max-w-[260px] p-1 px-2 text-[11px] rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 placeholder:text-slate-400"
                            />
                          )}
                        </div>
                      </>
                    )}

                    {/* Dropdown / Radio Options Editor */}
                    {(field.type === 'Dropdown' || field.type === 'RadioGroup' || field.type === 'CheckboxGroup') && (
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
                        <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Options</span>
                        {(field.options || []).map((opt, optIdx) => (
                          <div key={opt.id} className="flex items-center gap-2">
                            <input
                              type="text"
                              maxLength={30}
                              aria-label={`Option ${optIdx + 1}`}
                              value={opt.title}
                              onChange={(e) => {
                                const newOpts = [...(field.options || [])]
                                newOpts[optIdx] = { ...opt, title: e.target.value }
                                updateField(fieldIdx, { options: newOpts })
                              }}
                              className="flex-1 p-1 text-xs rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                            />
                            <button
                              type="button"
                              aria-label={`Remove option ${opt.title}`}
                              disabled={(field.options || []).length <= 1}
                              onClick={() => {
                                const newOpts = (field.options || []).filter((_, i) => i !== optIdx)
                                updateField(fieldIdx, { options: newOpts })
                              }}
                              className="p-1 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            const newOpt = {
                              id: `opt_${Date.now().toString(36)}`,
                              title: `Option ${(field.options || []).length + 1}`,
                            }
                            updateField(fieldIdx, { options: [...(field.options || []), newOpt] })
                          }}
                          className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          + Add Option
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-20 text-slate-500 dark:text-slate-400">Select or create a screen to edit.</div>
          )}
        </fieldset>

        {/* Right Column: Live WhatsApp Mobile Simulator (intentionally dark to match WhatsApp UI) */}
        <aside className="w-96 border-l border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-[#080d10] p-6 flex flex-col items-center justify-center z-10">
          <div className="text-center mb-3">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Preview</span>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">Approximate. WhatsApp draws the final form.</p>
          </div>

          {/* Smartphone Frame Mockup - kept dark to simulate WhatsApp */}
          <div className="w-[310px] h-[600px] rounded-[40px] border-4 border-slate-300 dark:border-slate-700 bg-[#121b22] flex flex-col overflow-hidden shadow-2xl relative">
            {/* WhatsApp Sheet Header */}
            <div className="bg-[#1f2c34] px-4 py-3 flex items-center justify-between border-b border-slate-700/60">
              <div className="flex items-center gap-2.5">
                <button className="text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
                <span className="font-semibold text-xs text-white line-clamp-1">
                  {currentScreen?.title || 'Interactive Form'}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">
                {activeScreenIndex + 1}/{screens.length}
              </span>
            </div>

            {/* Sheet Form Body */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              {(currentScreen?.layout?.children || []).map((field) => (
                <div key={field.id} className="space-y-1">
                  {!DISPLAY_ONLY_TYPES.includes(field.type) && field.type !== 'OptIn' && (
                    <label className="text-[11px] font-medium text-slate-300 flex items-center justify-between">
                      <span>{field.label}</span>
                      {field.required && <span className="text-emerald-400 text-[10px]">*</span>}
                    </label>
                  )}

                  {field.type === 'TextInput' && (
                    <input
                      type="text"
                      placeholder={field.helper_text || 'Enter answer...'}
                      value={previewValues[field.name] || ''}
                      onChange={(e) => setPreviewValues({ ...previewValues, [field.name]: e.target.value })}
                      className="w-full p-2.5 text-xs rounded-xl bg-[#202c33] border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-[#00a884]"
                    />
                  )}

                  {field.type === 'TextArea' && (
                    <textarea
                      rows={3}
                      placeholder={field.helper_text || 'Enter details...'}
                      value={previewValues[field.name] || ''}
                      onChange={(e) => setPreviewValues({ ...previewValues, [field.name]: e.target.value })}
                      className="w-full p-2.5 text-xs rounded-xl bg-[#202c33] border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-[#00a884]"
                    />
                  )}

                  {field.type === 'Dropdown' && (
                    <select
                      value={previewValues[field.name] || ''}
                      onChange={(e) => setPreviewValues({ ...previewValues, [field.name]: e.target.value })}
                      className="w-full p-2.5 text-xs rounded-xl bg-[#202c33] border border-slate-700 text-white focus:outline-none focus:border-[#00a884]"
                    >
                      <option value="">Select an option...</option>
                      {(field.options || []).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.title}
                        </option>
                      ))}
                    </select>
                  )}

                  {field.type === 'CheckboxGroup' && (
                    <div className="space-y-1.5 pt-1">
                      {(field.options || []).map((o) => {
                        const selected: string[] = Array.isArray(previewValues[field.name]) ? previewValues[field.name] : []
                        return (
                          <label key={o.id} className="flex items-center gap-2 p-2 rounded-xl bg-[#202c33] border border-slate-700 text-xs cursor-pointer hover:border-slate-600">
                            <input
                              type="checkbox"
                              checked={selected.includes(o.id)}
                              onChange={(e) =>
                                setPreviewValues({ ...previewValues, [field.name]: e.target.checked ? [...selected, o.id] : selected.filter((id) => id !== o.id) })
                              }
                              className="accent-[#00a884]"
                            />
                            <span className="text-slate-200">{o.title}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}

                  {field.type === 'TimePicker' && (
                    <select
                      value={previewValues[field.name] || ''}
                      onChange={(e) => setPreviewValues({ ...previewValues, [field.name]: e.target.value })}
                      className="w-full p-2.5 text-xs rounded-xl bg-[#202c33] border border-slate-700 text-white focus:outline-none focus:border-[#00a884]"
                    >
                      <option value="">Select a time...</option>
                      {((field.options?.length ? field.options.map((o) => o.title) : ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'])).map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                    </select>
                  )}

                  {field.type === 'RadioGroup' && (
                    <div className="space-y-1.5 pt-1">
                      {(field.options || []).map((o) => (
                        <label
                          key={o.id}
                          className="flex items-center gap-2 p-2 rounded-xl bg-[#202c33] border border-slate-700 text-xs cursor-pointer hover:border-slate-600"
                        >
                          <input
                            type="radio"
                            name={field.name}
                            value={o.id}
                            checked={previewValues[field.name] === o.id}
                            onChange={() => setPreviewValues({ ...previewValues, [field.name]: o.id })}
                            className="accent-[#00a884]"
                          />
                          <span className="text-slate-200">{o.title}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {field.type === 'DatePicker' && (
                    <input
                      type="date"
                      value={previewValues[field.name] || ''}
                      onChange={(e) => setPreviewValues({ ...previewValues, [field.name]: e.target.value })}
                      className="w-full p-2.5 text-xs rounded-xl bg-[#202c33] border border-slate-700 text-white focus:outline-none focus:border-[#00a884]"
                    />
                  )}

                  {field.type === 'OptIn' && (
                    <label className="flex items-start gap-2 pt-1 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(previewValues[field.name])}
                        onChange={(e) => setPreviewValues({ ...previewValues, [field.name]: e.target.checked })}
                        className="mt-0.5 rounded accent-[#00a884]"
                      />
                      <span>{field.label}</span>
                    </label>
                  )}

                  {field.type === 'TextCaption' && <p className="text-[11px] text-slate-400 leading-relaxed">{field.label}</p>}
                  {field.type === 'TextBody' && <p className="text-xs text-slate-200 leading-relaxed">{field.label}</p>}
                  {field.type === 'TextSubheading' && <p className="text-[13px] font-semibold text-white">{field.label}</p>}
                </div>
              ))}

              {previewSubmittedData && (
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-[11px] text-emerald-300 font-mono space-y-1">
                  <span className="font-bold">What your flow receives:</span>
                  <pre className="text-[10px] overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(previewSubmittedData, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Bottom Primary Action Button */}
            <div className="p-3 bg-[#1f2c34] border-t border-slate-700/60">
              <button
                onClick={() => {
                  if (activeScreenIndex < screens.length - 1) {
                    setActiveScreenIndex((i) => i + 1)
                  } else {
                    setPreviewSubmittedData({ ...previewValues, submitted_at: new Date().toISOString() })
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-[#00a884] hover:bg-[#008f70] text-slate-900 font-bold text-xs shadow-md transition-colors"
              >
                {activeScreenIndex < screens.length - 1 ? 'Continue' : 'Submit'}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Meta JSON Spec Export Modal */}
      {showJsonModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#11181c] rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCode2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Flow JSON sent to Meta</h3>
              </div>
              <button type="button" aria-label="Close" onClick={() => setShowJsonModal(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
This is generated from the screens above (Flow JSON version 7.3). You do not need to edit it.
            </p>

            <pre className="p-4 rounded-xl bg-slate-50 dark:bg-[#080d10] border border-slate-200 dark:border-slate-800 text-xs font-mono text-emerald-700 dark:text-emerald-400 max-h-96 overflow-y-auto whitespace-pre-wrap">
              {JSON.stringify(getCompiledJson(), null, 2)}
            </pre>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowJsonModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Close
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(getCompiledJson(), null, 2))
                  setCopiedJson(true)
                  setTimeout(() => setCopiedJson(false), 2000)
                }}
                className="px-4 py-2 rounded-xl bg-[#008069] text-white text-xs font-semibold hover:bg-[#00705c] flex items-center gap-1.5"
              >
                {copiedJson ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedJson ? 'Copied!' : 'Copy JSON'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

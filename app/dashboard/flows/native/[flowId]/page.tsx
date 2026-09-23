'use client'

import React, { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
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
  Layers,
  Calendar,
  List,
  Type,
  AlignLeft,
  CheckSquare,
  HelpCircle,
  Eye,
  Settings,
  X,
  ExternalLink,
} from 'lucide-react'
import { MetaFlowScreen, MetaFormField, isFlowBetaAllowed } from '@/lib/flows/flow-types'
import { compileMetaFlowJSON } from '@/lib/flows/meta-flows-spec'

export default function NativeFlowDesignerPage() {
  const params = useParams()
  const router = useRouter()
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
  const [saving, setSaving] = useState(false)
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
        if (res.ok) {
          const data = await res.json()
          const f = data.flow

          if (!isFlowBetaAllowed(f.organization_id)) {
            router.replace('/dashboard')
            return
          }

          setNativeFlow(f)
          setFlowName(f.name)
          setStatus(f.status || 'DRAFT')
          setCategory(f.categories?.[0] || 'LEAD_GENERATION')
          setScreens(f.screens || [])
        }
      } catch (err) {
        console.error('Failed to load native flow:', err)
      } finally {
        setLoading(false)
      }
    }
    loadFlow()
  }, [flowId])

  // Save Native Flow
  const saveFlow = async () => {
    if (!flowId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/flows/native/${flowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: flowName,
          status,
          categories: [category],
          screens,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setNativeFlow(data.flow)
      }
    } catch (err) {
      console.error('Failed to save native flow:', err)
    } finally {
      setSaving(false)
    }
  }

  // Active Screen
  const currentScreen: MetaFlowScreen | undefined = screens[activeScreenIndex]

  // Add Screen
  const addScreen = () => {
    const newScreenId = `SCREEN_${screens.length + 1}`
    const newScreen: MetaFlowScreen = {
      id: newScreenId,
      title: `Step ${screens.length + 1}`,
      terminal: true,
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            id: `field_${Date.now()}`,
            type: 'TextInput',
            label: 'Your Response',
            name: `input_${screens.length + 1}`,
            required: true,
          },
        ],
      },
    }

    // Set previous screens to terminal: false
    const updated = screens.map((s) => ({ ...s, terminal: false }))
    setScreens([...updated, newScreen])
    setActiveScreenIndex(screens.length)
  }

  // Delete Screen
  const deleteScreen = (idx: number) => {
    if (screens.length <= 1) {
      alert('A WhatsApp Flow must have at least one screen.')
      return
    }
    const filtered = screens.filter((_, i) => i !== idx)
    setScreens(filtered)
    setActiveScreenIndex(Math.max(0, idx - 1))
  }

  // Add Component Field to Current Screen
  const addField = (type: MetaFormField['type']) => {
    if (!currentScreen) return
    const fieldId = `field_${Date.now().toString(36)}`
    let newField: MetaFormField = {
      id: fieldId,
      type,
      label: `New ${type}`,
      name: `${type.toLowerCase()}_${Date.now().toString(36).slice(-4)}`,
      required: true,
    }

    if (type === 'Dropdown' || type === 'RadioGroup') {
      newField.options = [
        { id: 'opt_1', title: 'Option 1' },
        { id: 'opt_2', title: 'Option 2' },
      ]
    }

    const updatedChildren = [...(currentScreen.layout?.children || []), newField]
    updateScreenChildren(updatedChildren)
  }

  // Update Field
  const updateField = (fieldIndex: number, updates: Partial<MetaFormField>) => {
    if (!currentScreen) return
    const updatedChildren = (currentScreen.layout?.children || []).map((f, i) =>
      i === fieldIndex ? { ...f, ...updates } : f
    )
    updateScreenChildren(updatedChildren)
  }

  // Delete Field
  const deleteField = (fieldIndex: number) => {
    if (!currentScreen) return
    const updatedChildren = (currentScreen.layout?.children || []).filter((_, i) => i !== fieldIndex)
    updateScreenChildren(updatedChildren)
  }

  // Update Children Helper
  const updateScreenChildren = (children: MetaFormField[]) => {
    setScreens((prev) =>
      prev.map((s, idx) =>
        idx === activeScreenIndex
          ? {
              ...s,
              layout: {
                ...s.layout,
                children,
              },
            }
          : s
      )
    )
  }

  // Compile JSON Spec
  const getCompiledJson = () => {
    try {
      return compileMetaFlowJSON(screens)
    } catch (e: any) {
      return { error: e.message }
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-900 text-white">
        <div className="flex items-center gap-3">
          <Smartphone className="w-6 h-6 text-indigo-400 animate-spin" />
          <span>Loading Screen Designer...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0f12] text-slate-100 select-none overflow-hidden font-sans">
      {/* Top Header */}
      <header className="h-14 border-b border-slate-800 bg-[#11181c] px-4 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/flows"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>

          <div className="flex items-center gap-2">
            <span className="p-1 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Smartphone className="w-4 h-4" />
            </span>
            <input
              type="text"
              value={flowName}
              onChange={(e) => setFlowName(e.target.value)}
              className="bg-transparent font-bold text-sm tracking-tight text-white hover:bg-slate-800/40 px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
            Meta Spec v3.1
          </span>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="text-xs p-1.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 focus:outline-none"
          >
            <option value="DRAFT">DRAFT</option>
            <option value="PUBLISHED">PUBLISHED</option>
          </select>

          <button
            onClick={() => setShowJsonModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/20 text-xs font-semibold shadow-sm transition-all"
          >
            <FileCode2 className="w-3.5 h-3.5" />
            <span>Export Meta JSON</span>
          </button>

          <button
            onClick={saveFlow}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#008069] hover:bg-[#00705c] text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save Flow'}</span>
          </button>
        </div>
      </header>

      {/* Main Builder Grid */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Screens List & Component Palette */}
        <aside className="w-64 border-r border-slate-800 bg-[#11181c] p-4 flex flex-col justify-between overflow-y-auto z-10">
          <div className="space-y-5">
            {/* Screens List */}
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">Screens</span>
                <button
                  onClick={addScreen}
                  className="p-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-xs flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </div>

              <div className="mt-2 space-y-1.5">
                {screens.map((screen, idx) => (
                  <div
                    key={screen.id}
                    onClick={() => setActiveScreenIndex(idx)}
                    className={`p-2 rounded-xl text-xs flex items-center justify-between cursor-pointer border transition-all ${
                      idx === activeScreenIndex
                        ? 'bg-indigo-950/40 border-indigo-500/50 text-indigo-200 font-semibold'
                        : 'bg-slate-800/40 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-slate-800 text-[10px] flex items-center justify-center font-mono">
                        {idx + 1}
                      </span>
                      <span className="truncate max-w-[120px]">{screen.title}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      {screen.terminal && (
                        <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                          End
                        </span>
                      )}
                      {screens.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteScreen(idx)
                          }}
                          className="p-1 text-slate-500 hover:text-rose-400"
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
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wide block pb-2 border-b border-slate-800">
                Add Field
              </span>
              <div className="mt-2 space-y-1.5">
                {[
                  { type: 'TextInput', label: 'Text Input', icon: Type },
                  { type: 'TextArea', label: 'Multi-line Text', icon: AlignLeft },
                  { type: 'Dropdown', label: 'Dropdown Selector', icon: List },
                  { type: 'RadioGroup', label: 'Single Choice Radio', icon: CheckSquare },
                  { type: 'DatePicker', label: 'Date Picker', icon: Calendar },
                  { type: 'OptIn', label: 'Opt-in Checkbox', icon: CheckSquare },
                  { type: 'TextCaption', label: 'Instruction Caption', icon: HelpCircle },
                ].map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.type}
                      onClick={() => addField(item.type as any)}
                      className="w-full text-left p-2 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 text-xs flex items-center gap-2.5 text-slate-300 hover:text-white transition-all group"
                    >
                      <Icon className="w-3.5 h-3.5 text-indigo-400 group-hover:scale-110 transition-transform" />
                      <span>{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </aside>

        {/* Center Column: Screen Form Designer */}
        <div className="flex-1 p-6 overflow-y-auto bg-[#0c1216]">
          {currentScreen ? (
            <div className="max-w-2xl mx-auto space-y-5">
              {/* Screen Metadata */}
              <div className="p-4 rounded-2xl bg-[#11181c] border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-slate-200">Screen Properties</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Terminal Screen:</span>
                    <input
                      type="checkbox"
                      checked={Boolean(currentScreen.terminal)}
                      onChange={(e) => {
                        const updated = screens.map((s, i) =>
                          i === activeScreenIndex ? { ...s, terminal: e.target.checked } : s
                        )
                        setScreens(updated)
                      }}
                      className="rounded accent-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-400">Screen ID</label>
                    <input
                      type="text"
                      value={currentScreen.id}
                      onChange={(e) => {
                        const updated = screens.map((s, i) =>
                          i === activeScreenIndex ? { ...s, id: e.target.value } : s
                        )
                        setScreens(updated)
                      }}
                      className="w-full mt-1 p-2 text-xs rounded-xl bg-slate-900 border border-slate-700 font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-400">Screen Header Title</label>
                    <input
                      type="text"
                      value={currentScreen.title}
                      onChange={(e) => {
                        const updated = screens.map((s, i) =>
                          i === activeScreenIndex ? { ...s, title: e.target.value } : s
                        )
                        setScreens(updated)
                      }}
                      className="w-full mt-1 p-2 text-xs rounded-xl bg-slate-900 border border-slate-700"
                    />
                  </div>
                </div>
              </div>

              {/* Fields List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Screen Form Elements ({currentScreen.layout?.children?.length || 0})
                  </span>
                </div>

                {(currentScreen.layout?.children || []).map((field, fieldIdx) => (
                  <div
                    key={field.id || fieldIdx}
                    className="p-4 rounded-2xl bg-[#161f26] border border-slate-800 space-y-3 hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono uppercase bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded font-bold">
                          {field.type}
                        </span>
                        <span className="text-xs font-semibold text-slate-200">{field.label}</span>
                      </div>

                      <button
                        onClick={() => deleteField(fieldIdx)}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-slate-400 font-medium">Field Label</label>
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updateField(fieldIdx, { label: e.target.value })}
                          className="w-full mt-1 p-1.5 text-xs rounded-lg bg-slate-900 border border-slate-700"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-400 font-medium">Payload Name Key</label>
                        <input
                          type="text"
                          value={field.name}
                          onChange={(e) => updateField(fieldIdx, { name: e.target.value })}
                          className="w-full mt-1 p-1.5 text-xs rounded-lg bg-slate-900 border border-slate-700 font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-400">Required Field:</span>
                        <input
                          type="checkbox"
                          checked={Boolean(field.required)}
                          onChange={(e) => updateField(fieldIdx, { required: e.target.checked })}
                          className="rounded accent-indigo-500"
                        />
                      </div>

                      <div>
                        <input
                          type="text"
                          value={field.helper_text || ''}
                          onChange={(e) => updateField(fieldIdx, { helper_text: e.target.value })}
                          placeholder="Helper hint text..."
                          className="p-1 px-2 text-[11px] rounded-lg bg-slate-900 border border-slate-700 text-slate-300 w-48"
                        />
                      </div>
                    </div>

                    {/* Dropdown / Radio Options Editor */}
                    {(field.type === 'Dropdown' || field.type === 'RadioGroup') && (
                      <div className="pt-2 border-t border-slate-800 space-y-1.5">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase">Options</span>
                        {(field.options || []).map((opt, optIdx) => (
                          <div key={opt.id} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={opt.title}
                              onChange={(e) => {
                                const newOpts = [...(field.options || [])]
                                newOpts[optIdx] = { ...opt, title: e.target.value }
                                updateField(fieldIdx, { options: newOpts })
                              }}
                              className="flex-1 p-1 text-xs rounded bg-slate-900 border border-slate-700"
                            />
                            <button
                              onClick={() => {
                                const newOpts = (field.options || []).filter((_, i) => i !== optIdx)
                                updateField(fieldIdx, { options: newOpts })
                              }}
                              className="text-slate-400 hover:text-rose-400 text-xs"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            const newOpt = {
                              id: `opt_${Date.now().toString(36)}`,
                              title: `Option ${(field.options || []).length + 1}`,
                            }
                            updateField(fieldIdx, { options: [...(field.options || []), newOpt] })
                          }}
                          className="text-[10px] text-indigo-400 hover:underline"
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
            <div className="text-center py-20 text-slate-400">Select or create a screen to edit.</div>
          )}
        </div>

        {/* Right Column: Live WhatsApp Mobile Simulator */}
        <aside className="w-96 border-l border-slate-800 bg-[#080d10] p-6 flex flex-col items-center justify-center z-10">
          <div className="text-center mb-3">
            <span className="text-xs font-bold text-slate-300">Live WhatsApp In-App Preview</span>
            <p className="text-[10px] text-slate-500">Official Meta Flow v3.1 rendering</p>
          </div>

          {/* Smartphone Frame Mockup */}
          <div className="w-[310px] h-[600px] rounded-[40px] border-4 border-slate-700 bg-[#121b22] flex flex-col overflow-hidden shadow-2xl relative">
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
                  {field.type !== 'TextCaption' && (
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

                  {field.type === 'TextCaption' && (
                    <p className="text-[11px] text-slate-400 bg-[#202c33]/50 p-2.5 rounded-xl border border-slate-700/50 leading-relaxed">
                      {field.label}
                    </p>
                  )}
                </div>
              ))}

              {previewSubmittedData && (
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-[11px] text-emerald-300 font-mono space-y-1">
                  <span className="font-bold">✓ Form Response JSON:</span>
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
          <div className="bg-[#11181c] rounded-2xl border border-slate-800 w-full max-w-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCode2 className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-base">Meta Flow Specification v3.1 JSON</h3>
              </div>
              <button onClick={() => setShowJsonModal(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              This is the official JSON schema ready to sync with Meta WhatsApp Business Cloud API.
            </p>

            <pre className="p-4 rounded-xl bg-[#080d10] border border-slate-800 text-xs font-mono text-emerald-400 max-h-96 overflow-y-auto whitespace-pre-wrap">
              {JSON.stringify(getCompiledJson(), null, 2)}
            </pre>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowJsonModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800"
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

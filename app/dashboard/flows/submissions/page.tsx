'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, restoreSupabaseSession } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { isFlowBetaAllowed } from '@/lib/flows/flow-types'
import {
  ArrowLeft,
  FileSpreadsheet,
  Search,
  Filter,
  X,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Download,
  Calendar,
  User,
  Phone,
  Workflow,
  Clock,
  CheckCircle2,
  AlertCircle,
  SlidersHorizontal,
  ChevronDown,
  Eye,
  Loader2,
  Copy,
  Check,
  RefreshCw,
  Layers,
  Sparkles,
  Variable,
  FileText,
} from 'lucide-react'

interface Submission {
  id: string
  organization_id: string
  flow_id: string | null
  workflow_id: string | null
  session_id: string | null
  flow_token: string
  conversation_id: string | null
  contact_phone: string
  lead_id: string | null
  response_payload: Record<string, any>
  created_at: string
  updated_at: string | null
  workflow_name: string | null
  flow_name: string | null
  contact_name: string | null
  contact_email: string | null
  question_labels: Record<string, string>
}

interface FilterCondition {
  id: string
  field: string
  operator: string
  value: string
}

interface FilterField {
  key: string
  label: string
  variableName: string
  category: 'standard' | 'response' | 'inner'
  type: 'text' | 'number' | 'boolean' | 'date' | 'select'
  options?: { value: string; label: string }[]
}

const OPERATORS_BY_TYPE: Record<string, { value: string; label: string }[]> = {
  text: [
    { value: 'contains', label: 'Contains' },
    { value: 'eq', label: 'Equals' },
    { value: 'neq', label: 'Not equals' },
    { value: 'starts_with', label: 'Starts with' },
    { value: 'ends_with', label: 'Ends with' },
    { value: 'exists', label: 'Has value' },
    { value: 'not_exists', label: 'Is empty' },
  ],
  number: [
    { value: 'eq', label: 'Equals (=)' },
    { value: 'gt', label: 'Greater than (>)' },
    { value: 'gte', label: 'Greater or equal (>=)' },
    { value: 'lt', label: 'Less than (<)' },
    { value: 'lte', label: 'Less or equal (<=)' },
    { value: 'neq', label: 'Not equals (!=)' },
    { value: 'exists', label: 'Has value' },
    { value: 'not_exists', label: 'Is empty' },
  ],
  boolean: [
    { value: 'eq', label: 'Is' },
    { value: 'neq', label: 'Is not' },
    { value: 'exists', label: 'Has value' },
    { value: 'not_exists', label: 'Is empty' },
  ],
  select: [
    { value: 'eq', label: 'Equals' },
    { value: 'neq', label: 'Not equals' },
    { value: 'contains', label: 'Contains' },
    { value: 'exists', label: 'Has value' },
    { value: 'not_exists', label: 'Is empty' },
  ],
  date: [
    { value: 'eq', label: 'On date' },
    { value: 'gte', label: 'On or after' },
    { value: 'lte', label: 'On or before' },
    { value: 'gt', label: 'After' },
    { value: 'lt', label: 'Before' },
    { value: 'exists', label: 'Has date' },
    { value: 'not_exists', label: 'No date' },
  ],
}

export default function SubmittedResponsesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const workflowId = searchParams.get('workflowId')
  const flowId = searchParams.get('flowId')
  const workflowName = searchParams.get('name') || 'Flow'

  const [orgId, setOrgId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(25)
  const [totalPages, setTotalPages] = useState(1)

  // Filters
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<FilterCondition[]>([])
  const [availableFields, setAvailableFields] = useState<FilterField[]>([])
  const [globalSearch, setGlobalSearch] = useState('')

  // Detail modal
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null)
  const [copiedPayload, setCopiedPayload] = useState(false)

  // Initialize
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
        console.error('Failed to init user:', err)
      }
    }
    initUser()
  }, [])

  // Fetch available filter fields
  const fetchFilterFields = useCallback(async (organizationId: string) => {
    try {
      const res = await fetch('/api/flows/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          workflowId: workflowId || undefined,
          flowId: flowId || undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setAvailableFields(data.fields || [])
      }
    } catch (err) {
      console.error('Failed to fetch filter fields:', err)
    }
  }, [workflowId, flowId])

  // Fetch submissions
  const fetchSubmissions = useCallback(async (organizationId: string, currentPage: number, activeFilters: FilterCondition[]) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        organizationId,
        page: String(currentPage),
        pageSize: String(pageSize),
      })

      if (workflowId) params.set('workflowId', workflowId)
      if (flowId) params.set('flowId', flowId)

      const validFilters = activeFilters.filter(f => f.field && f.operator)
      if (validFilters.length > 0) {
        params.set('filters', JSON.stringify(
          validFilters.map(f => ({
            field: f.field,
            operator: f.operator,
            value: f.value,
          }))
        ))
      }

      const res = await fetch(`/api/flows/submissions?${params}`)
      if (res.ok) {
        const data = await res.json()
        setSubmissions(data.submissions || [])
        setTotal(data.total || 0)
        setTotalPages(data.totalPages || 1)
      }
    } catch (err) {
      console.error('Failed to fetch submissions:', err)
    } finally {
      setLoading(false)
    }
  }, [workflowId, flowId, pageSize])

  useEffect(() => {
    if (orgId) {
      fetchFilterFields(orgId)
      fetchSubmissions(orgId, page, filters)
    }
  }, [orgId, page])

  const applyFilters = () => {
    setPage(1)
    if (orgId) {
      fetchSubmissions(orgId, 1, filters)
    }
  }

  const clearFilters = () => {
    setFilters([])
    setPage(1)
    if (orgId) {
      fetchSubmissions(orgId, 1, [])
    }
  }

  const addFilter = () => {
    const defaultField = availableFields[0]?.key || 'contact_phone'
    const fieldDef = availableFields.find(f => f.key === defaultField)
    const fieldType = fieldDef?.type || 'text'
    const defaultOp = OPERATORS_BY_TYPE[fieldType]?.[0]?.value || 'contains'

    setFilters(prev => [
      ...prev,
      {
        id: `filter-${Date.now()}`,
        field: defaultField,
        operator: defaultOp,
        value: fieldType === 'boolean' ? 'true' : '',
      },
    ])
  }

  const updateFilter = (id: string, updates: Partial<FilterCondition>) => {
    setFilters(prev =>
      prev.map(f => {
        if (f.id !== id) return f
        const updated = { ...f, ...updates }
        // If field changed, adapt operator and default value
        if (updates.field && updates.field !== f.field) {
          const fieldDef = availableFields.find(x => x.key === updates.field)
          const fieldType = fieldDef?.type || 'text'
          const ops = OPERATORS_BY_TYPE[fieldType] || OPERATORS_BY_TYPE.text
          updated.operator = ops[0]?.value || 'contains'
          updated.value = fieldType === 'boolean' ? 'true' : fieldDef?.options?.[0]?.value || ''
        }
        return updated
      })
    )
  }

  const removeFilter = (id: string) => {
    setFilters(prev => prev.filter(f => f.id !== id))
  }

  // Extract all unique response keys from submissions across all pages/submissions
  const allResponseKeys = useMemo(() => {
    const keys = new Set<string>()
    // First add known response variables from availableFields
    availableFields.forEach(f => {
      if (f.category === 'response' || f.category === 'inner') {
        keys.add(f.key)
      }
    })
    // Also include any other keys found in current loaded submissions
    submissions.forEach(s => {
      if (s.response_payload && typeof s.response_payload === 'object') {
        Object.keys(s.response_payload).forEach(k => {
          if (k !== 'flow_token' && !k.startsWith('_')) {
            keys.add(k)
          }
        })
      }
    })
    return Array.from(keys)
  }, [availableFields, submissions])

  // Client-side instant quick search
  const displayedSubmissions = useMemo(() => {
    if (!globalSearch.trim()) return submissions
    const searchLower = globalSearch.toLowerCase().trim()
    return submissions.filter(s => {
      const phone = (s.contact_phone || '').toLowerCase()
      const name = (s.contact_name || '').toLowerCase()
      const email = (s.contact_email || '').toLowerCase()
      const flowName = (s.flow_name || '').toLowerCase()
      const workflowName = (s.workflow_name || '').toLowerCase()
      const payloadStr = JSON.stringify(s.response_payload || {}).toLowerCase()
      return phone.includes(searchLower) || name.includes(searchLower) || email.includes(searchLower) ||
        flowName.includes(searchLower) || workflowName.includes(searchLower) || payloadStr.includes(searchLower)
    })
  }, [submissions, globalSearch])

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const getStatusBadge = (submission: Submission) => {
    if (submission.lead_id) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
          <CheckCircle2 className="w-3 h-3" />
          Lead Created
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 whitespace-nowrap">
        <CheckCircle2 className="w-3 h-3" />
        Submitted
      </span>
    )
  }

  // Format cell value for Excel-like rendering
  const renderCellValue = (val: any) => {
    if (val === undefined || val === null || val === '') {
      return <span className="text-slate-300 dark:text-slate-600 font-mono select-none">—</span>
    }
    if (typeof val === 'boolean') {
      return val ? (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
          ✓ True
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
          ✗ False
        </span>
      )
    }
    if (typeof val === 'object') {
      const jsonStr = JSON.stringify(val)
      return (
        <span
          className="font-mono text-[10px] text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800 truncate block max-w-[200px]"
          title={jsonStr}
        >
          {jsonStr}
        </span>
      )
    }
    const str = String(val)
    return (
      <span className="truncate block max-w-[240px]" title={str}>
        {str}
      </span>
    )
  }

  const exportCSV = () => {
    if (!submissions.length) return

    const headers = [
      'Row',
      'Contact Name',
      'Phone Number',
      'Email',
      'Flow Name',
      'Workflow Name',
      'Submission Date',
      'Status',
      'Lead ID',
      ...allResponseKeys.map(k => {
        const label = submissions[0]?.question_labels?.[k] || k.replace(/_/g, ' ')
        return `${label} (${k})`
      }),
    ]

    const rows = submissions.map((s, idx) => [
      idx + 1,
      s.contact_name || '',
      s.contact_phone,
      s.contact_email || '',
      s.flow_name || '',
      s.workflow_name || '',
      formatDate(s.created_at),
      s.lead_id ? 'Lead Created' : 'Submitted',
      s.lead_id || '',
      ...allResponseKeys.map(k => {
        const val = s.response_payload?.[k]
        if (typeof val === 'object' && val !== null) return JSON.stringify(val)
        return String(val ?? '')
      }),
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `flow-responses-${workflowId || flowId || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Categorized fields for filter dropdown
  const standardFilterFields = availableFields.filter(f => f.category === 'standard')
  const responseFilterFields = availableFields.filter(f => f.category === 'response')
  const innerFilterFields = availableFields.filter(f => f.category === 'inner')

  return (
    <div className="w-full h-full overflow-y-auto bg-slate-50 dark:bg-[#0c1317] text-slate-900 dark:text-slate-100">
      <div className="max-w-[1600px] mx-auto p-4 md:p-8 space-y-5">

        {/* Top Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/flows"
              className="p-2 rounded-xl bg-white dark:bg-[#111b21] border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shadow-2xs"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-2xs">
                  <FileSpreadsheet className="w-5 h-5" />
                </span>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight">Submitted Responses</h1>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {workflowName ? `Responses for "${decodeURIComponent(workflowName)}"` : 'All flow submissions'} • {total} total responses recorded
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => orgId && fetchSubmissions(orgId, page, filters)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-[#111b21] border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/80 shadow-2xs transition-all"
              title="Refresh submissions"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
            <button
              onClick={exportCSV}
              disabled={submissions.length === 0}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-40 shadow-xs transition-all"
            >
              <Download className="w-4 h-4" />
              <span>Export Excel / CSV</span>
            </button>
          </div>
        </div>

        {/* Search and Dynamic Filter Bar */}
        <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-2xs">
          <div className="p-3.5 flex flex-col sm:flex-row items-center gap-3">
            {/* Quick search */}
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search across all fields, phones, names, or inner variables..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0c1317] focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-slate-900 dark:text-slate-100"
              />
            </div>

            {/* Filter Toggle Button */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                showFilters || filters.length > 0
                  ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Dynamic Filters{filters.length > 0 ? ` (${filters.length})` : ''}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* Dynamic Filters Panel */}
          {showFilters && (
            <div className="border-t border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-slate-50/50 dark:bg-[#0c1317]/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                    <Filter className="w-3.5 h-3.5" />
                  </span>
                  <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                    MongoDB-Style Dynamic Filters
                  </h3>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    (Supports standard fields, flow questions, and inner nested variables)
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {filters.length > 0 && (
                    <button
                      onClick={clearFilters}
                      className="text-xs text-slate-500 hover:text-rose-500 transition-colors font-medium px-2 py-1"
                    >
                      Reset All
                    </button>
                  )}
                  <button
                    onClick={addFilter}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Condition</span>
                  </button>
                </div>
              </div>

              {filters.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  No filters applied yet. Click <span className="font-semibold text-indigo-500">"+ Add Condition"</span> to filter by any flow question, response value, or inner variable.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filters.map((filter, index) => {
                    const fieldDef = availableFields.find(f => f.key === filter.field)
                    const fieldType = fieldDef?.type || 'text'
                    const operators = OPERATORS_BY_TYPE[fieldType] || OPERATORS_BY_TYPE.text

                    return (
                      <div
                        key={filter.id}
                        className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-white dark:bg-[#111b21] border border-slate-200 dark:border-slate-700 shadow-2xs"
                      >
                        {index > 0 && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 font-mono">
                            AND
                          </span>
                        )}

                        {/* Field Selector with categorized groups */}
                        <div className="relative min-w-[220px] max-w-[320px] flex-1">
                          <select
                            value={filter.field}
                            onChange={(e) => updateFilter(filter.id, { field: e.target.value })}
                            className="w-full px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0c1317] text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            <optgroup label="📌 Standard System Fields">
                              {standardFilterFields.map(field => (
                                <option key={field.key} value={field.key}>
                                  {field.label} ({field.key})
                                </option>
                              ))}
                            </optgroup>

                            {responseFilterFields.length > 0 && (
                              <optgroup label="📝 Flow Response Variables">
                                {responseFilterFields.map(field => (
                                  <option key={field.key} value={field.key}>
                                    {field.label} [{field.key}]
                                  </option>
                                ))}
                              </optgroup>
                            )}

                            {innerFilterFields.length > 0 && (
                              <optgroup label="⚙️ Inner / Nested Variables">
                                {innerFilterFields.map(field => (
                                  <option key={field.key} value={field.key}>
                                    inner: {field.key}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </div>

                        {/* Operator Selector */}
                        <div className="min-w-[130px]">
                          <select
                            value={filter.operator}
                            onChange={(e) => updateFilter(filter.id, { operator: e.target.value })}
                            className="w-full px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0c1317] text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            {operators.map(op => (
                              <option key={op.value} value={op.value}>
                                {op.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Smart Value Input */}
                        {!['exists', 'not_exists'].includes(filter.operator) && (
                          <div className="flex-1 min-w-[160px]">
                            {fieldType === 'boolean' ? (
                              <select
                                value={filter.value}
                                onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                                className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0c1317] text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              >
                                <option value="true">✓ True / Checked</option>
                                <option value="false">✗ False / Unchecked</option>
                              </select>
                            ) : fieldDef?.options && fieldDef.options.length > 0 ? (
                              <select
                                value={filter.value}
                                onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                                className="w-full px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0c1317] text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              >
                                <option value="">Select option...</option>
                                {fieldDef.options.map(opt => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label} ({opt.value})
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={fieldType === 'date' ? 'date' : fieldType === 'number' ? 'number' : 'text'}
                                value={filter.value}
                                onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                                placeholder={
                                  fieldType === 'date' ? '' :
                                  fieldType === 'number' ? 'e.g. 500' :
                                  'Enter search value...'
                                }
                                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0c1317] text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-400"
                              />
                            )}
                          </div>
                        )}

                        {/* Remove button */}
                        <button
                          onClick={() => removeFilter(filter.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                          title="Remove condition"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )
                  })}

                  <div className="pt-2 flex items-center justify-between">
                    <p className="text-[11px] text-slate-400">
                      Combine multiple conditions with AND logic to precisely isolate respondent segments.
                    </p>
                    <button
                      onClick={applyFilters}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-all"
                    >
                      Apply Filter Query
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Excel Spreadsheet Table Container */}
        <div className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111b21] shadow-sm overflow-hidden flex flex-col">
          {/* Spreadsheet Ribbon / Top bar */}
          <div className="px-4 py-2.5 bg-slate-100/80 dark:bg-[#162026] border-b border-slate-300 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-600 text-white font-semibold text-xs shadow-xs">
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Responses Sheet</span>
              </div>
              <span className="text-slate-400 dark:text-slate-600">•</span>
              <span className="text-slate-600 dark:text-slate-300 font-medium">
                {displayedSubmissions.length} of {total} {total === 1 ? 'row' : 'rows'}
              </span>
              <span className="text-slate-400 dark:text-slate-600">•</span>
              <span className="text-slate-500 dark:text-slate-400">
                {allResponseKeys.length} question {allResponseKeys.length === 1 ? 'column' : 'columns'}
              </span>
              {filters.length > 0 && (
                <span className="ml-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 text-[11px] font-semibold border border-indigo-200 dark:border-indigo-800">
                  {filters.length} active filter{filters.length > 1 ? 's' : ''}
                </span>
              )}
            </div>

            <div className="text-[11px] text-slate-400 hidden sm:inline">
              Click any row to open full submission inspector
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-28 text-slate-400 dark:text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
              <p className="text-xs font-semibold">Loading spreadsheet rows...</p>
            </div>
          ) : displayedSubmissions.length === 0 ? (
            <div className="text-center py-24 space-y-3">
              <FileSpreadsheet className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto" />
              <h3 className="font-semibold text-base text-slate-700 dark:text-slate-300">No Submissions Found</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                {filters.length > 0
                  ? 'No rows match your current dynamic filters. Try adjusting or clearing your query.'
                  : 'No form responses have been submitted yet for this flow.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-visible">
              <table className="w-full text-xs border-collapse border-spacing-0">
                {/* Excel Table Header */}
                <thead>
                  <tr className="bg-slate-100 dark:bg-[#162026] text-slate-700 dark:text-slate-200 border-b-2 border-slate-300 dark:border-slate-700 select-none">
                    {/* Excel Row # Index Column */}
                    <th className="w-12 min-w-[48px] max-w-[48px] px-2 py-2.5 text-center font-mono font-bold text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-[#162026] border-r border-slate-300 dark:border-slate-700 sticky left-0 z-20 shadow-xs">
                      #
                    </th>

                    {/* Standard Columns */}
                    <th className="min-w-[190px] max-w-[240px] px-3.5 py-2.5 text-left font-semibold border-r border-slate-300 dark:border-slate-700">
                      <div className="flex items-center gap-1.5 uppercase text-[11px] tracking-wider text-slate-700 dark:text-slate-300">
                        <User className="w-3.5 h-3.5 text-slate-500" />
                        <span>Contact</span>
                      </div>
                    </th>

                    <th className="min-w-[170px] max-w-[220px] px-3.5 py-2.5 text-left font-semibold border-r border-slate-300 dark:border-slate-700">
                      <div className="flex items-center gap-1.5 uppercase text-[11px] tracking-wider text-slate-700 dark:text-slate-300">
                        <Workflow className="w-3.5 h-3.5 text-slate-500" />
                        <span>Flow</span>
                      </div>
                    </th>

                    <th className="min-w-[155px] max-w-[175px] px-3.5 py-2.5 text-left font-semibold border-r border-slate-300 dark:border-slate-700">
                      <div className="flex items-center gap-1.5 uppercase text-[11px] tracking-wider text-slate-700 dark:text-slate-300">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        <span>Submitted</span>
                      </div>
                    </th>

                    {/* ALL Dynamic Response & Inner Variable Columns (with non-overlapping min-width, truncate, & clean inner variable badge) */}
                    {allResponseKeys.map(key => {
                      const label = submissions[0]?.question_labels?.[key] || key.replace(/_/g, ' ')
                      return (
                        <th
                          key={key}
                          className="min-w-[200px] max-w-[280px] px-3.5 py-2.5 text-left font-semibold border-r border-slate-300 dark:border-slate-700"
                        >
                          <div className="flex flex-col">
                            <span
                              className="truncate block font-semibold text-[11px] uppercase tracking-wider text-slate-800 dark:text-slate-200"
                              title={label}
                            >
                              {label}
                            </span>
                            <span
                              className="font-mono text-[10px] text-indigo-600 dark:text-indigo-400 font-normal truncate block mt-0.5"
                              title={`Variable key: ${key}`}
                            >
                              var: {key}
                            </span>
                          </div>
                        </th>
                      )
                    })}

                    <th className="min-w-[130px] max-w-[140px] px-3.5 py-2.5 text-left font-semibold border-r border-slate-300 dark:border-slate-700 uppercase text-[11px] tracking-wider text-slate-700 dark:text-slate-300">
                      Status
                    </th>

                    <th className="w-14 min-w-[56px] px-2 py-2.5 text-center font-semibold uppercase text-[11px] tracking-wider text-slate-700 dark:text-slate-300">
                      Details
                    </th>
                  </tr>
                </thead>

                {/* Excel Table Body with clean gridlines */}
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {displayedSubmissions.map((submission, index) => {
                    const rowNum = (page - 1) * pageSize + index + 1
                    return (
                      <tr
                        key={submission.id}
                        onClick={() => setSelectedSubmission(submission)}
                        className="odd:bg-white even:bg-slate-50/60 dark:odd:bg-[#111b21] dark:even:bg-[#0e161b] hover:bg-indigo-50/50 dark:hover:bg-indigo-950/25 transition-colors cursor-pointer group"
                      >
                        {/* Excel Row # Index Column */}
                        <td className="w-12 min-w-[48px] max-w-[48px] px-2 py-2 text-center font-mono font-medium text-[11px] text-slate-400 dark:text-slate-500 bg-slate-50/80 dark:bg-[#151f26]/80 border-r border-slate-200 dark:border-slate-800 sticky left-0 z-10 group-hover:bg-indigo-100/50 dark:group-hover:bg-indigo-900/30">
                          {rowNum}
                        </td>

                        {/* Contact Cell */}
                        <td className="px-3.5 py-2 border-r border-slate-200 dark:border-slate-800 min-w-[190px] max-w-[240px]">
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {submission.contact_name || 'Unknown Contact'}
                            </p>
                            <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                              <Phone className="w-3 h-3 text-slate-400" />
                              {submission.contact_phone}
                            </p>
                            {submission.contact_email && (
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                                {submission.contact_email}
                              </p>
                            )}
                          </div>
                        </td>

                        {/* Flow Cell */}
                        <td className="px-3.5 py-2 border-r border-slate-200 dark:border-slate-800 min-w-[170px] max-w-[220px]">
                          <div>
                            <p className="font-medium text-slate-800 dark:text-slate-200 truncate">
                              {submission.flow_name || '—'}
                            </p>
                            {submission.workflow_name && (
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                                via {submission.workflow_name}
                              </p>
                            )}
                          </div>
                        </td>

                        {/* Date Cell */}
                        <td className="px-3.5 py-2 border-r border-slate-200 dark:border-slate-800 min-w-[155px] max-w-[175px] font-mono text-[11px] text-slate-600 dark:text-slate-400">
                          {formatDate(submission.created_at)}
                        </td>

                        {/* ALL Dynamic Response & Inner Variable Cells */}
                        {allResponseKeys.map(key => {
                          const val = submission.response_payload?.[key]
                          return (
                            <td
                              key={key}
                              className="px-3.5 py-2 border-r border-slate-200 dark:border-slate-800 min-w-[200px] max-w-[280px]"
                            >
                              {renderCellValue(val)}
                            </td>
                          )
                        })}

                        {/* Status Cell */}
                        <td className="px-3.5 py-2 border-r border-slate-200 dark:border-slate-800 min-w-[130px] max-w-[140px]">
                          {getStatusBadge(submission)}
                        </td>

                        {/* Details Eye Button */}
                        <td className="w-14 min-w-[56px] px-2 py-2 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedSubmission(submission)
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors"
                            title="View response details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Excel Spreadsheet Status Bar & Pagination */}
          <div className="px-4 py-2.5 bg-slate-100/80 dark:bg-[#162026] border-t border-slate-300 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Row {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}
              </span>
              <span>of {total} total entries</span>
              <span>•</span>
              <span>Page {page} of {totalPages}</span>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number
                  if (totalPages <= 5) pageNum = i + 1
                  else if (page <= 3) pageNum = i + 1
                  else if (page >= totalPages - 2) pageNum = totalPages - 4 + i
                  else pageNum = page - 2 + i

                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`w-7 h-7 rounded-lg text-xs font-semibold transition-colors ${
                        pageNum === page
                          ? 'bg-emerald-600 text-white shadow-2xs'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
                      }`}
                    >
                      {pageNum}
                    </button>
                  )
                })}

                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Response Detail Slide-Over Drawer */}
      {selectedSubmission && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-start justify-end"
          onClick={() => setSelectedSubmission(null)}
        >
          <div
            className="bg-white dark:bg-[#111b21] h-full w-full max-w-xl border-l border-slate-200 dark:border-slate-800 shadow-2xl overflow-y-auto animate-in slide-in-from-right"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-white dark:bg-[#111b21] border-b border-slate-200 dark:border-slate-800 p-5 flex items-center justify-between z-10">
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <FileSpreadsheet className="w-5 h-5" />
                </span>
                <div>
                  <h2 className="font-bold text-base">Submission Record Details</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Received {formatDate(selectedSubmission.created_at)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedSubmission(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-6">
              {/* Contact Information */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  Contact Information
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 dark:bg-[#0c1317] rounded-xl p-3 border border-slate-200 dark:border-slate-800">
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Name</p>
                    <p className="text-sm font-semibold mt-1">{selectedSubmission.contact_name || 'Unknown'}</p>
                  </div>
                  <div className="bg-slate-50 dark:bg-[#0c1317] rounded-xl p-3 border border-slate-200 dark:border-slate-800">
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Phone</p>
                    <p className="text-sm font-semibold mt-1 font-mono">{selectedSubmission.contact_phone}</p>
                  </div>
                  {selectedSubmission.contact_email && (
                    <div className="col-span-2 bg-slate-50 dark:bg-[#0c1317] rounded-xl p-3 border border-slate-200 dark:border-slate-800">
                      <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Email</p>
                      <p className="text-sm font-semibold mt-1">{selectedSubmission.contact_email}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Flow Context */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  Flow Context
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 dark:bg-[#0c1317] rounded-xl p-3 border border-slate-200 dark:border-slate-800">
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Flow Name</p>
                    <p className="text-sm font-semibold mt-1">{selectedSubmission.flow_name || '—'}</p>
                  </div>
                  <div className="bg-slate-50 dark:bg-[#0c1317] rounded-xl p-3 border border-slate-200 dark:border-slate-800">
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Form Approval</p>
                    <div className="mt-1">
                      {selectedSubmission.flow_id ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span>Meta Approved</span>
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500 font-medium">Standard Flow</span>
                      )}
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-[#0c1317] rounded-xl p-3 border border-slate-200 dark:border-slate-800">
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Pipeline Status</p>
                    <div className="mt-1">{getStatusBadge(selectedSubmission)}</div>
                  </div>
                  <div className="bg-slate-50 dark:bg-[#0c1317] rounded-xl p-3 border border-slate-200 dark:border-slate-800">
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Workflow</p>
                    <p className="text-sm font-semibold mt-1">{selectedSubmission.workflow_name || '—'}</p>
                  </div>
                </div>
              </div>

              {/* Form Question Responses */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Form Question Responses
                  </h3>
                  <span className="text-[10px] text-indigo-500 font-mono">
                    {Object.keys(selectedSubmission.response_payload || {}).filter(k => k !== 'flow_token' && !k.startsWith('_')).length} variables
                  </span>
                </div>

                <div className="space-y-2.5">
                  {selectedSubmission.response_payload &&
                    Object.entries(selectedSubmission.response_payload)
                      .filter(([key]) => key !== 'flow_token' && !key.startsWith('_'))
                      .map(([key, value]) => {
                        const question = selectedSubmission.question_labels?.[key] || key.replace(/_/g, ' ')
                        return (
                          <div
                            key={key}
                            className="bg-slate-50 dark:bg-[#0c1317] rounded-xl p-3.5 border border-slate-200 dark:border-slate-800 space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                {question}
                              </span>
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                                {key}
                              </span>
                            </div>
                            <div className="pt-1">
                              {typeof value === 'boolean' ? (
                                value ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                                    ✓ True / Opted In
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                    ✗ False / Opted Out
                                  </span>
                                )
                              ) : typeof value === 'object' ? (
                                <pre className="text-xs font-mono bg-white dark:bg-[#111b21] p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 overflow-x-auto whitespace-pre-wrap">
                                  {JSON.stringify(value, null, 2)}
                                </pre>
                              ) : (
                                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 bg-white dark:bg-[#111b21] p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                                  {String(value)}
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                </div>
              </div>

              {/* Raw JSON Payload */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Raw Payload JSON
                  </h3>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(selectedSubmission.response_payload, null, 2))
                      setCopiedPayload(true)
                      setTimeout(() => setCopiedPayload(false), 2000)
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    {copiedPayload ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedPayload ? 'Copied' : 'Copy JSON'}</span>
                  </button>
                </div>
                <pre className="text-[11px] font-mono bg-slate-50 dark:bg-[#0c1317] p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 overflow-x-auto max-h-48 whitespace-pre-wrap">
                  {JSON.stringify(selectedSubmission.response_payload, null, 2)}
                </pre>
              </div>

              {/* Metadata */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  System Identifiers
                </h3>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1 font-mono bg-slate-50 dark:bg-[#0c1317] p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  <p><span className="text-slate-400">Submission ID:</span> {selectedSubmission.id}</p>
                  <p><span className="text-slate-400">Flow Token:</span> {selectedSubmission.flow_token}</p>
                  {selectedSubmission.conversation_id && (
                    <p><span className="text-slate-400">Conversation:</span> {selectedSubmission.conversation_id}</p>
                  )}
                  {selectedSubmission.lead_id && (
                    <p><span className="text-slate-400">Lead ID:</span> {selectedSubmission.lead_id}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

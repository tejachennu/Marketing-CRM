import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyOrgAccess } from '@/lib/api-auth-helper'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

interface FilterCondition {
  field: string
  operator: string
  value: any
}

// Safely get nested value from object using dot notation path (e.g. "user.address.city")
function getNestedValue(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object') return undefined
  if (path in obj) return obj[path]
  const parts = path.split('.')
  let current = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = current[part]
  }
  return current
}

// Recursively extract all keys and inner nested paths from an object
function extractKeysRecursively(obj: any, prefix = '', result: { key: string; type: string; sampleValue: any }[] = []): { key: string; type: string; sampleValue: any }[] {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return result
  for (const [key, val] of Object.entries(obj)) {
    if (key === 'flow_token' || key.startsWith('_')) continue
    const fullPath = prefix ? `${prefix}.${key}` : key
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      extractKeysRecursively(val, fullPath, result)
    } else {
      let inferredType = 'text'
      if (typeof val === 'boolean') inferredType = 'boolean'
      else if (typeof val === 'number') inferredType = 'number'
      else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) inferredType = 'date'
      result.push({ key: fullPath, type: inferredType, sampleValue: val })
    }
  }
  return result
}

function evaluateCondition(actualValue: any, operator: string, targetValue: any): boolean {
  if (operator === 'exists') {
    return actualValue !== undefined && actualValue !== null && actualValue !== ''
  }
  if (operator === 'not_exists') {
    return actualValue === undefined || actualValue === null || actualValue === ''
  }

  if (actualValue === undefined || actualValue === null) {
    return false
  }

  // Handle boolean comparison
  if (typeof actualValue === 'boolean' || targetValue === 'true' || targetValue === 'false') {
    const bActual = String(actualValue).toLowerCase() === 'true'
    const bTarget = String(targetValue).toLowerCase() === 'true'
    if (operator === 'eq') return bActual === bTarget
    if (operator === 'neq') return bActual !== bTarget
    return bActual === bTarget
  }

  const sActual = String(actualValue).toLowerCase().trim()
  const sTarget = targetValue !== undefined && targetValue !== null ? String(targetValue).toLowerCase().trim() : ''

  switch (operator) {
    case 'eq':
      return sActual === sTarget
    case 'neq':
      return sActual !== sTarget
    case 'contains':
      return sActual.includes(sTarget)
    case 'not_contains':
      return !sActual.includes(sTarget)
    case 'starts_with':
      return sActual.startsWith(sTarget)
    case 'ends_with':
      return sActual.endsWith(sTarget)
    case 'gt':
      return Number(actualValue) > Number(targetValue)
    case 'gte':
      return Number(actualValue) >= Number(targetValue)
    case 'lt':
      return Number(actualValue) < Number(targetValue)
    case 'lte':
      return Number(actualValue) <= Number(targetValue)
    case 'in':
      if (Array.isArray(targetValue)) {
        return targetValue.map(v => String(v).toLowerCase().trim()).includes(sActual)
      }
      return sTarget.split(',').map(v => v.trim()).includes(sActual)
    case 'not_in':
      if (Array.isArray(targetValue)) {
        return !targetValue.map(v => String(v).toLowerCase().trim()).includes(sActual)
      }
      return !sTarget.split(',').map(v => v.trim()).includes(sActual)
    default:
      return true
  }
}

// PostgREST returns at most this many rows per request (db-max-rows), so larger reads are batched
const SQL_BATCH_SIZE = 1000
// The most rows one request reads: the export limit, and how far a filter that runs in memory looks back
const MAX_SCAN_ROWS = 10000
// Columns added by enrichSubmissions, which filters can only see after contacts, forms and workflows are joined
const ENRICHED_FIELDS = new Set(['contact_name', 'contact_email', 'flow_name', 'workflow_name', 'question_labels'])

function matchesFilters(submission: any, filters: FilterCondition[]): boolean {
  return filters.every((filter) => {
    let actualValue: any = undefined

    if (filter.field === 'status') {
      actualValue = submission.lead_id ? 'lead_created' : 'submitted'
    } else if (filter.field in submission) {
      actualValue = submission[filter.field]
    } else if (submission.response_payload) {
      actualValue = getNestedValue(submission.response_payload, filter.field)
    }

    if (actualValue === undefined) {
      actualValue = getNestedValue(submission, filter.field)
    }

    return evaluateCondition(actualValue, filter.operator, filter.value)
  })
}

/** "Lead status is / is not ..." matches a column exactly, so it can be filtered in SQL. */
function isStatusColumnFilter(filter: FilterCondition): boolean {
  return filter.field === 'status' && ['eq', 'neq'].includes(filter.operator) && ['lead_created', 'submitted'].includes(String(filter.value ?? '').toLowerCase().trim())
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')
    const workflowId = searchParams.get('workflowId')
    const flowId = searchParams.get('flowId')
    // An export asks for every matching row (up to MAX_SCAN_ROWS) in one response
    const isExport = searchParams.get('export') === '1'
    const page = isExport ? 1 : Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const pageSize = isExport ? MAX_SCAN_ROWS : Math.min(Math.max(1, parseInt(searchParams.get('pageSize') || '25', 10) || 25), 100)
    const filtersParam = searchParams.get('filters')

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId, { permission: 'records.view_all' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    // Parse filters
    let filters: FilterCondition[] = []
    if (filtersParam) {
      try {
        filters = JSON.parse(filtersParam)
      } catch {
        return NextResponse.json({ error: 'Invalid filters JSON' }, { status: 400 })
      }
    }
    const validFilters = Array.isArray(filters) ? filters.filter(f => f && f.field && f.operator) : []
    const sqlFilters = validFilters.filter(isStatusColumnFilter)
    const memoryFilters = validFilters.filter(f => !isStatusColumnFilter(f))

    const supabase = getSupabaseClient()

    // Build base query; id breaks ties so pages never repeat or skip rows
    const buildQuery = (withCount = false) => {
      let query = supabase
        .from('flow_submissions')
        .select('*', withCount ? { count: 'exact' } : undefined)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })

      if (workflowId) query = query.eq('workflow_id', workflowId)
      if (flowId) query = query.eq('flow_id', flowId)
      for (const filter of sqlFilters) {
        const wantsLead = (String(filter.value).toLowerCase().trim() === 'lead_created') === (filter.operator === 'eq')
        query = wantsLead ? query.not('lead_id', 'is', null) : query.is('lead_id', null)
      }
      return query
    }

    const from = (page - 1) * pageSize
    let pageRows: any[] = []
    let totalCount = 0
    let truncated = false
    let enrichedAlready = false

    if (!memoryFilters.length) {
      // Paginate in SQL; the count is of every matching row, not just this page
      const first = await buildQuery(true).range(from, from + Math.min(pageSize, SQL_BATCH_SIZE) - 1)
      if (first.error?.code === 'PGRST103') {
        // A page past the end is refused when a count is requested; count from the start instead
        const counted = await buildQuery(true).range(0, 0)
        if (counted.error) throw counted.error
        totalCount = counted.count ?? 0
      } else {
        if (first.error) throw first.error
        pageRows = first.data || []
        totalCount = first.count ?? pageRows.length
      }
      const end = Math.min(from + pageSize, totalCount)
      while (pageRows.length && from + pageRows.length < end) {
        const start = from + pageRows.length
        const next = await buildQuery().range(start, Math.min(start + SQL_BATCH_SIZE, end) - 1)
        if (next.error) throw next.error
        if (!next.data?.length) break
        pageRows.push(...next.data)
      }
      truncated = isExport && totalCount > pageRows.length
    } else {
      // Answer, contact and form-name filters can't be expressed in SQL, so the newest
      // MAX_SCAN_ROWS submissions are read in batches and filtered here. Older submissions are
      // not searched by these filters; `truncated` tells the page when that limit was reached.
      const needsEnrichment = memoryFilters.some(f => ENRICHED_FIELDS.has(f.field))
      const matches: any[] = []
      let scanned = 0
      while (scanned < MAX_SCAN_ROWS) {
        const { data, error } = await buildQuery().range(scanned, Math.min(scanned + SQL_BATCH_SIZE, MAX_SCAN_ROWS) - 1)
        if (error) throw error
        if (!data?.length) break
        scanned += data.length
        const batch = needsEnrichment ? await enrichSubmissions(supabase, data, orgId) : data
        matches.push(...batch.filter(submission => matchesFilters(submission, memoryFilters)))
        truncated = scanned >= MAX_SCAN_ROWS
      }
      totalCount = matches.length
      pageRows = matches.slice(from, from + pageSize)
      enrichedAlready = needsEnrichment
    }

    // Enrich the returned rows with contact info, flow names, and question labels
    const submissions = enrichedAlready ? pageRows : await enrichSubmissions(supabase, pageRows, orgId)

    return NextResponse.json({
      submissions,
      total: totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      truncated,
    })
  } catch (error: any) {
    console.error('[Submissions GET] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

/** Phone numbers are stored with and without "+" and spacing; compare them by their digits. */
function phoneDigits(phone: any): string {
  return String(phone || '').replace(/\D/g, '')
}

async function enrichSubmissions(supabase: any, submissions: any[], orgId: string) {
  if (!submissions.length) return []

  const workflowIds = [...new Set(submissions.map((s) => s.workflow_id).filter(Boolean))]
  const flowIds = [...new Set(submissions.map((s) => s.flow_id).filter(Boolean))]
  // Contacts may hold "+919876543210" or "919876543210", so both spellings are looked up, in chunks
  // small enough to keep the request URL short
  const digits = [...new Set(submissions.map((s: any) => phoneDigits(s.contact_phone)).filter(Boolean))]
  const contactLookups = []
  for (let i = 0; i < digits.length; i += 100) {
    const chunk = digits.slice(i, i + 100)
    contactLookups.push(
      supabase.from('contacts').select('id, first_name, last_name, email, phone_number').eq('organization_id', orgId).in('phone_number', chunk.flatMap((d) => [d, `+${d}`]))
    )
  }

  const [workflowsRes, flowsRes, ...contactResults] = await Promise.all([
    workflowIds.length > 0
      ? supabase.from('whatsapp_workflows').select('id, name').eq('organization_id', orgId).in('id', workflowIds)
      : { data: [] },
    flowIds.length > 0
      ? supabase.from('whatsapp_native_flows').select('id, name, screens').eq('organization_id', orgId).in('id', flowIds)
      : { data: [] },
    ...contactLookups,
  ])

  const workflowMap = Object.fromEntries((workflowsRes.data || []).map((w: any) => [w.id, w]))
  const flowMap = Object.fromEntries((flowsRes.data || []).map((f: any) => [f.id, f]))
  const contactMap: Record<string, any> = {}
  for (const result of contactResults) {
    // Missing contact details shouldn't hide the answers, but they shouldn't fail silently either
    if (result.error) console.error('[Submissions GET] Contact lookup failed:', result.error)
    for (const contact of result.data || []) {
      const key = phoneDigits(contact.phone_number)
      if (key && !contactMap[key]) contactMap[key] = contact
    }
  }

  return submissions.map((submission: any) => {
    const workflow = workflowMap[submission.workflow_id]
    const flow = flowMap[submission.flow_id]
    const contact = contactMap[phoneDigits(submission.contact_phone)]
    const contactName = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ').trim()

    let questionLabels: Record<string, string> = {}
    if (flow?.screens) {
      for (const screen of flow.screens) {
        const fields = screen.layout?.children || []
        for (const field of fields) {
          if (field.name) {
            questionLabels[field.name] = field.label || field.name
          }
        }
      }
    }

    return {
      ...submission,
      workflow_name: workflow?.name || null,
      flow_name: flow?.name || null,
      contact_name: contactName || null,
      contact_email: contact?.email || null,
      question_labels: questionLabels,
    }
  })
}

// POST endpoint: fetch all available filter fields including standard fields, response variables, and inner variables
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId, workflowId, flowId } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId, { permission: 'records.view_all' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()

    // 1. Fetch native flow screens to extract question labels, types, and options
    let fieldLabels: Record<string, string> = {}
    let fieldTypes: Record<string, string> = {}
    let fieldOptions: Record<string, { value: string; label: string }[]> = {}
    const knownFlowVariables = new Set<string>()

    const targetFlowId = flowId || (workflowId ? await getFlowIdFromWorkflow(supabase, workflowId, organizationId) : null)
    if (targetFlowId) {
      const { data: flow } = await supabase
        .from('whatsapp_native_flows')
        .select('screens')
        .eq('id', targetFlowId)
        .eq('organization_id', organizationId)
        .maybeSingle()

      if (flow?.screens) {
        for (const screen of flow.screens) {
          const fields = screen.layout?.children || []
          for (const field of fields) {
            if (field.name) {
              knownFlowVariables.add(field.name)
              fieldLabels[field.name] = field.label || field.name
              if (field.type === 'OptIn') {
                fieldTypes[field.name] = 'boolean'
              } else if (field.type === 'DatePicker') {
                fieldTypes[field.name] = 'date'
              } else if (field.type === 'Dropdown' || field.type === 'RadioGroup' || field.type === 'CheckboxGroup') {
                // Checkbox answers are lists, so they keep text operators ("contains") but still list their options
                fieldTypes[field.name] = field.type === 'CheckboxGroup' ? 'text' : 'select'
                if (Array.isArray(field.options)) {
                  fieldOptions[field.name] = field.options.map((opt: any) => ({
                    value: opt.id || opt.title,
                    label: opt.title || opt.id,
                  }))
                }
              } else if (field.type === 'TextInput' && (field.input_type === 'number' || field.input_type === 'numeric')) {
                fieldTypes[field.name] = 'number'
              } else {
                fieldTypes[field.name] = 'text'
              }
            }
          }
        }
      }
    }

    // 2. Fetch recent submissions to discover all actual keys & inner nested variables
    let submissionsQuery = supabase
      .from('flow_submissions')
      .select('response_payload')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (workflowId) submissionsQuery = submissionsQuery.eq('workflow_id', workflowId)
    if (flowId) submissionsQuery = submissionsQuery.eq('flow_id', flowId)

    const { data: submissions } = await submissionsQuery

    // Recursively extract all keys and inner nested keys
    const discoveredVars: Record<string, { key: string; type: string; isNested: boolean; sampleValue: any }> = {}

    for (const sub of submissions || []) {
      if (sub.response_payload && typeof sub.response_payload === 'object') {
        const extracted = extractKeysRecursively(sub.response_payload)
        for (const item of extracted) {
          const isNested = item.key.includes('.')
          if (!discoveredVars[item.key]) {
            discoveredVars[item.key] = {
              key: item.key,
              type: fieldTypes[item.key] || item.type,
              isNested,
              sampleValue: item.sampleValue,
            }
          }
        }
      }
    }

    // Standard contact & system fields
    const standardFields = [
      { key: 'contact_name', label: 'Contact Name', variableName: 'contact_name', category: 'standard', type: 'text' },
      { key: 'contact_phone', label: 'Phone Number', variableName: 'contact_phone', category: 'standard', type: 'text' },
      { key: 'contact_email', label: 'Email Address', variableName: 'contact_email', category: 'standard', type: 'text' },
      { key: 'created_at', label: 'Submission Date', variableName: 'created_at', category: 'standard', type: 'date' },
      { key: 'flow_name', label: 'Flow Name', variableName: 'flow_name', category: 'standard', type: 'text' },
      { key: 'workflow_name', label: 'Workflow Name', variableName: 'workflow_name', category: 'standard', type: 'text' },
      {
        key: 'status',
        label: 'Lead Status',
        variableName: 'status',
        category: 'standard',
        type: 'select',
        options: [
          { value: 'lead_created', label: 'Lead Created' },
          { value: 'submitted', label: 'Submitted (No Lead)' },
        ],
      },
    ]

    // Flow Response Variables (top-level fields defined in screens or top-level payload)
    const allTopLevelKeys = new Set([...Array.from(knownFlowVariables), ...Object.keys(discoveredVars).filter(k => !k.includes('.'))])
    const responseVariables = Array.from(allTopLevelKeys).map((key) => {
      const disc = discoveredVars[key]
      return {
        key,
        label: fieldLabels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        variableName: key,
        category: 'response',
        type: fieldTypes[key] || disc?.type || 'text',
        options: fieldOptions[key] || undefined,
      }
    })

    // Inner / Nested Variables (e.g. "appointment.date", "user.profile.budget")
    const innerNestedVariables = Object.values(discoveredVars)
      .filter((v) => v.isNested)
      .map((v) => ({
        key: v.key,
        label: v.key.replace(/_/g, ' '),
        variableName: v.key,
        category: 'inner',
        type: v.type,
      }))

    const filterFields = [
      ...standardFields,
      ...responseVariables,
      ...innerNestedVariables,
    ]

    return NextResponse.json({ fields: filterFields })
  } catch (error: any) {
    console.error('[Submissions Fields POST] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

async function getFlowIdFromWorkflow(supabase: any, workflowId: string, orgId: string): Promise<string | null> {
  const { data: workflow } = await supabase
    .from('whatsapp_workflows')
    .select('canvas_nodes')
    .eq('id', workflowId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!workflow?.canvas_nodes) return null

  const nativeFlowNode = workflow.canvas_nodes.find(
    (node: any) => node.type === 'native_flow_trigger'
  )

  return nativeFlowNode?.data?.native_flow_id || nativeFlowNode?.data?.flowId || nativeFlowNode?.data?.flow_id || null
}

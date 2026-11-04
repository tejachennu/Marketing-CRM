import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyRecordAccess } from '@/lib/api-auth-helper'
import { can } from '@/lib/rbac'
import { getMetaCredentials, metaRequest, uploadNativeFlow, isMetaFlowGone, MetaFlowError, type MetaCredentials } from '@/lib/flows/meta-client'
import { compileMetaFlowJSON } from '@/lib/flows/meta-flows-spec'
import { refuseWhileFlowsOff } from '@/lib/flows/module-gate'

const CATEGORIES = ['SIGN_UP', 'SIGN_IN', 'APPOINTMENT_BOOKING', 'LEAD_GENERATION', 'CONTACT_US', 'CUSTOMER_SUPPORT', 'SURVEY', 'OTHER']
const ADDRESS_FORM_MESSAGE = "This form is the store's delivery address form; change it in Commerce → Store settings first"

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

async function loadOrganization(supabase: any, organizationId: string) {
  const { data: organization, error } = await supabase.from('organizations').select('*').eq('id', organizationId).single()
  if (error) throw error
  return organization
}

/** The organization's workflows that send this form, live or paused. */
async function findWorkflowsUsingForm(supabase: any, organizationId: string, formId: string): Promise<Array<{ id: string; name: string; is_active?: boolean }>> {
  const { data: workflows, error } = await supabase.from('whatsapp_workflows').select('id,name,is_active,canvas_nodes').eq('organization_id', organizationId)
  if (error) throw error
  return (workflows || []).filter((workflow: any) => (Array.isArray(workflow.canvas_nodes) ? workflow.canvas_nodes : []).some((node: any) => [node?.data?.native_flow_id, node?.data?.flowId, node?.data?.flow_id].includes(formId)))
}
const quoteNames = (workflows: Array<{ name: string }>) => workflows.map(workflow => `"${workflow.name}"`).join(', ')

/** True when the store sends this form for delivery addresses: Commerce has to stop using it before it can go. */
function isStoreAddressForm(organization: any, form: { flow_id_meta?: string | null }): boolean {
  return Boolean(form.flow_id_meta) && String(organization?.commerce_address_flow_id || '').trim() === String(form.flow_id_meta)
}

/** The HTTP status for a failure while talking to Meta, with the message the designer shows. */
function metaFailure(error: any): { status: number; message: string } {
  if (error instanceof MetaFlowError) return { status: 422, message: error.message }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return { status: 504, message: 'Meta did not answer in time. Try again in a moment.' }
  if (error instanceof TypeError && /fetch/i.test(String(error.message))) return { status: 502, message: 'WhatsApp (Meta) could not be reached. Check the connection and try again.' }
  return { status: 500, message: error?.message || 'Internal Server Error' }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Missing flow ID' }, { status: 400 })
    }

    const authResult = await verifyRecordAccess(request, 'whatsapp_native_flows', id)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()
    const { data: flow, error } = await supabase
      .from('whatsapp_native_flows')
      .select('*')
      .eq('id', id)
      .single()

    if (error) throw error

    // Submissions hold customers' phones and answers, so they need the same permission as /api/flows/submissions
    if (!can(authResult.user, 'records.view_all')) return NextResponse.json({ flow, submissions: [] })
    const { data: submissions, error: submissionsError } = await supabase
      .from('flow_submissions')
      .select('*')
      .eq('flow_id', id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (submissionsError) throw submissionsError
    return NextResponse.json({
      flow,
      submissions: submissions || [],
    })
  } catch (error: any) {
    console.error('[Native Flow GET ID] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * Saves a draft; with `action` it also talks to Meta: "validate" uploads the draft for Meta to
 * check, "publish" validates and publishes it, "deprecate" retires a published form so nothing
 * can send it any more. A plain save only asks Meta whether a form it already uploaded was published
 * meanwhile, and never fails on credentials or the network.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Missing flow ID' }, { status: 400 })
    }

    const authResult = await verifyRecordAccess(request, 'whatsapp_native_flows', id, { permission: 'automation.manage' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const body = await request.json()
    const supabase = getSupabaseClient()
    const { data: existing, error: loadError } = await supabase.from('whatsapp_native_flows').select('*').eq('id', id).single()
    if (loadError) throw loadError
    const switchedOff = await refuseWhileFlowsOff(supabase, existing.organization_id)
    if (switchedOff) return switchedOff
    if (body.meta_flow_id !== undefined || body.flow_id_meta !== undefined) return NextResponse.json({ error: 'Meta Flow IDs are assigned by the WhatsApp connection' }, { status: 400 })
    if (body.status && body.status !== existing.status) return NextResponse.json({ error: 'Use Validate, Publish or Retire to change a form status' }, { status: 400 })
    if (body.action && !['validate', 'publish', 'deprecate'].includes(body.action)) return NextResponse.json({ error: 'Unknown form action' }, { status: 400 })
    const published = existing.status === 'PUBLISHED' && Boolean(existing.flow_id_meta)

    if (body.action === 'deprecate') {
      if (!published) return NextResponse.json({ error: 'Only a published form can be retired' }, { status: 409 })
      const organization = await loadOrganization(supabase, existing.organization_id)
      if (isStoreAddressForm(organization, existing)) return NextResponse.json({ error: ADDRESS_FORM_MESSAGE }, { status: 409 })
      // A live flow would keep sending it: every customer would get the intro, then an apology
      const live = (await findWorkflowsUsingForm(supabase, existing.organization_id, id)).filter(workflow => workflow.is_active)
      if (live.length) {
        const one = live.length === 1
        return NextResponse.json({ error: `This form is sent by the live flow${one ? '' : 's'} ${quoteNames(live)}. Pause ${one ? 'that flow' : 'those flows'} or select another form in ${one ? 'it' : 'them'} before retiring this form.` }, { status: 409 })
      }
      let credentials: MetaCredentials
      try { credentials = getMetaCredentials(organization) }
      catch (error: any) { return NextResponse.json({ error: error.message }, { status: 400 }) }
      try {
        const result = await metaRequest(credentials, `${existing.flow_id_meta}/deprecate`, { method: 'POST' })
        if (result.success !== true) throw new MetaFlowError('Meta did not confirm that the form was retired')
      } catch (metaError) {
        // Already gone on Meta's side: nothing can send it any more, which is what retiring means
        if (!isMetaFlowGone(metaError)) throw metaError
      }
      const result = await supabase.from('whatsapp_native_flows').update({ status: 'DEPRECATED', updated_at: new Date().toISOString() }).eq('id', id).select().single()
      if (result.error) throw result.error
      return NextResponse.json({ flow: result.data, retired: true })
    }

    if (existing.status === 'DEPRECATED') return NextResponse.json({ error: 'This form was retired and can no longer be changed. Create a new form.' }, { status: 409 })
    if (published && (body.screens || body.name || body.categories)) return NextResponse.json({ error: 'Published forms are immutable. Create a new form to make changes.' }, { status: 409 })
    if (published) return NextResponse.json({ flow: existing })
    const screens = body.screens ?? existing.screens
    let flowJson
    try { flowJson = compileMetaFlowJSON(screens) }
    catch (error: any) { return NextResponse.json({ error: error.message }, { status: 400 }) }
    const categories = body.categories ?? existing.categories
    if (!Array.isArray(categories) || !categories.length || categories.some(category => !CATEGORIES.includes(category))) return NextResponse.json({ error: 'Select a valid form category' }, { status: 400 })
    const update: Record<string, any> = { name: (body.name ?? existing.name).trim(), categories, screens, flow_json: flowJson, status: 'DRAFT', updated_at: new Date().toISOString() }
    if (!update.name) return NextResponse.json({ error: 'Form name is required' }, { status: 400 })
    let credentials: MetaCredentials | undefined
    const organization = body.action || existing.flow_id_meta ? await loadOrganization(supabase, existing.organization_id) : null
    if (body.action) {
      // Missing credentials are the caller's to fix, not a server failure
      try { credentials = getMetaCredentials(organization) }
      catch (error: any) { return NextResponse.json({ error: error.message }, { status: 400 }) }
    }
    // Reconcile an interrupted publish (Meta published it, the answer was lost) before allowing any
    // local content edits, a plain save included: edits stored on a form Meta already published would
    // be shown and sent as if they were live.
    if (existing.flow_id_meta) {
      let remote: any = null
      if (credentials) remote = await metaRequest(credentials, `${existing.flow_id_meta}?fields=id,status`)
      else {
        // A plain save must not fail on credentials or the network: when Meta cannot be asked, it stays local
        try { remote = await metaRequest(getMetaCredentials(organization), `${existing.flow_id_meta}?fields=id,status`) } catch { remote = null }
      }
      if (remote?.status === 'PUBLISHED') {
        const result = await supabase.from('whatsapp_native_flows').update({ status: 'PUBLISHED' }).eq('id', id).select().single()
        if (result.error) throw result.error
        // The status is kept in sync; the edits in this request are not saved
        return NextResponse.json({ error: "This form was already published on Meta, so these changes were not saved. Duplicate the form to make changes.", flow: result.data }, { status: 409 })
      }
      if (remote && remote.status !== 'DRAFT') return NextResponse.json({ error: 'This form is no longer editable on Meta. Create a new form.' }, { status: 409 })
    }
    // Save the draft before calling Meta so rejected fields remain editable.
    const saved = await supabase.from('whatsapp_native_flows').update(update).eq('id', id).select().single()
    if (saved.error) throw saved.error
    let flow = saved.data
    if (body.action) {
      const metaId = await uploadNativeFlow(credentials!, flow, flowJson, async metaId => {
        const result = await supabase.from('whatsapp_native_flows').update({ flow_id_meta: metaId }).eq('id', id)
        if (result.error) throw result.error
        flow.flow_id_meta = metaId
      })
      if (body.action === 'publish') {
        const result = await metaRequest(credentials!, `${metaId}/publish`, { method: 'POST' })
        if (result.success !== true) throw new MetaFlowError('Meta did not confirm publication')
      }
      const status = body.action === 'publish' ? 'PUBLISHED' : 'DRAFT'
      const result = await supabase.from('whatsapp_native_flows').update({ status, updated_at: new Date().toISOString() }).eq('id', id).select().single()
      if (result.error) throw result.error
      flow = result.data
    }
    return NextResponse.json({ flow, validated: Boolean(body.action) })
  } catch (error: any) {
    console.error('[Native Flow PUT ID] Error:', error)
    const failure = metaFailure(error)
    return NextResponse.json({ error: failure.message, validationErrors: error instanceof MetaFlowError ? error.details : [] }, { status: failure.status })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Missing flow ID' }, { status: 400 })
    }

    const authResult = await verifyRecordAccess(request, 'whatsapp_native_flows', id, { permission: 'automation.manage' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()
    const { data: existing, error: loadError } = await supabase.from('whatsapp_native_flows').select('*').eq('id', id).single()
    if (loadError) throw loadError
    const switchedOff = await refuseWhileFlowsOff(supabase, existing.organization_id)
    if (switchedOff) return switchedOff
    if (existing.status === 'PUBLISHED' && existing.flow_id_meta) return NextResponse.json({ error: 'Published forms cannot be deleted. Retire the form first, then delete it.' }, { status: 409 })
    const organization = existing.flow_id_meta ? await loadOrganization(supabase, existing.organization_id) : null
    if (isStoreAddressForm(organization, existing)) return NextResponse.json({ error: ADDRESS_FORM_MESSAGE }, { status: 409 })
    // Paused flows count too: one that still sends this form could never go live again
    const usedBy = await findWorkflowsUsingForm(supabase, existing.organization_id, id)
    if (usedBy.length) {
      const names = quoteNames(usedBy)
      return NextResponse.json({ error: `This form is used by the flow${usedBy.length === 1 ? '' : 's'} ${names}. Remove it from ${usedBy.length === 1 ? 'that flow' : 'those flows'} before deleting it.` }, { status: 409 })
    }
    // Meta deletes drafts only; a retired form stays retired on Meta and only the local copy goes
    if (existing.flow_id_meta && existing.status !== 'DEPRECATED') {
      try {
        const result = await metaRequest(getMetaCredentials(organization), existing.flow_id_meta, { method: 'DELETE' })
        if (result.success !== true) throw new MetaFlowError('Meta did not confirm deletion')
      } catch (metaError) {
        // Already removed on Meta's side (deleted in WhatsApp Manager, or a stale ID): only the local copy is left
        if (!isMetaFlowGone(metaError)) throw metaError
      }
    }
    const { error } = await supabase
      .from('whatsapp_native_flows')
      .delete()
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true, deletedId: id })
  } catch (error: any) {
    console.error('[Native Flow DELETE ID] Error:', error)
    // Any other answer from Meta keeps the form, with Meta's own reason
    const failure = metaFailure(error)
    return NextResponse.json({ error: failure.message }, { status: failure.status })
  }
}

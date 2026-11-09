import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/pipeline/rules'
import { pipelineAccess, serverError } from '@/lib/pipeline/server'
import { loadStages } from '@/lib/pipeline/store'

export const runtime = 'nodejs'

const MAX_STAGES = 12
const stageName = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)

async function stagesWithCounts(db: any, organizationId: string) {
  const stages = await loadStages(db, organizationId)
  const { data } = await db.from('leads').select('pipeline_stage_id').eq('organization_id', organizationId).eq('status', 'active').limit(10000)
  const counts = new Map<string, number>()
  for (const row of data || []) counts.set(row.pipeline_stage_id, (counts.get(row.pipeline_stage_id) || 0) + 1)
  return stages.map((s: any) => ({ id: s.id, name: s.name, position: s.position, open: counts.get(s.id) || 0 }))
}

// GET ?organizationId: the stages, in order, with how many open deals each holds (managers and admins)
export async function GET(request: NextRequest) {
  const access = await pipelineAccess(request, new URL(request.url).searchParams.get('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  try {
    return NextResponse.json({ success: true, stages: await stagesWithCounts(access.ctx.db, access.ctx.organizationId) })
  } catch (error) {
    return serverError('stages', error)
  }
}

// POST { organizationId, name }: add a stage at the end
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await pipelineAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const { db, organizationId } = access.ctx
  const name = stageName(body?.name)
  if (!name) return NextResponse.json({ error: 'Give the stage a name, like "Site visit".', field: 'name' }, { status: 400 })
  try {
    const stages = await loadStages(db, organizationId)
    if (stages.length >= MAX_STAGES) return NextResponse.json({ error: `A pipeline can have up to ${MAX_STAGES} stages.` }, { status: 400 })
    if (stages.some((s: any) => s.name.toLowerCase() === name.toLowerCase())) return NextResponse.json({ error: 'There is already a stage with this name.', field: 'name' }, { status: 400 })
    const position = Math.max(0, ...stages.map((s: any) => Number(s.position) || 0)) + 1
    const { error } = await db.from('pipeline_stages').insert({ organization_id: organizationId, name, color: '#1D5BEA', position })
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true, stages: await stagesWithCounts(db, organizationId) }, { status: 201 })
  } catch (error) {
    return serverError('add stage', error)
  }
}

// PUT { organizationId, stages: [{ id, name }] }: rename and reorder (the order given is the new order)
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access = await pipelineAccess(request, body?.organizationId, 'automation.manage')
  if (!access.ok) return access.response
  const { db, organizationId } = access.ctx
  const given = Array.isArray(body?.stages) ? body.stages : []
  try {
    const stages = await loadStages(db, organizationId)
    const known = new Set(stages.map((s: any) => s.id))
    if (given.length !== stages.length || given.some((s: any) => !isUuid(s?.id) || !known.has(s.id)) || new Set(given.map((s: any) => s.id)).size !== given.length) {
      return NextResponse.json({ error: 'The stages changed while you were editing. Reload and try again.' }, { status: 409 })
    }
    const names = given.map((s: any) => stageName(s.name))
    if (names.some((n: string) => !n)) return NextResponse.json({ error: 'Every stage needs a name.', field: 'name' }, { status: 400 })
    if (new Set(names.map((n: string) => n.toLowerCase())).size !== names.length) return NextResponse.json({ error: 'Two stages have the same name.', field: 'name' }, { status: 400 })
    for (let i = 0; i < given.length; i++) {
      const { error } = await db.from('pipeline_stages').update({ name: names[i], position: i + 1 }).eq('organization_id', organizationId).eq('id', given[i].id)
      if (error) throw new Error(error.message)
    }
    return NextResponse.json({ success: true, stages: await stagesWithCounts(db, organizationId) })
  } catch (error) {
    return serverError('save stages', error)
  }
}

// DELETE ?organizationId&id&moveTo: remove a stage; its deals move to another stage first
export async function DELETE(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await pipelineAccess(request, params.get('organizationId'), 'automation.manage')
  if (!access.ok) return access.response
  const { db, organizationId } = access.ctx
  const id = params.get('id')
  const moveTo = params.get('moveTo')
  try {
    const stages = await loadStages(db, organizationId)
    if (!stages.some((s: any) => s.id === id)) return NextResponse.json({ error: 'That stage is not in this workspace.' }, { status: 404 })
    if (stages.length <= 1) return NextResponse.json({ error: 'The pipeline needs at least one stage.' }, { status: 400 })
    const target = moveTo && moveTo !== id && stages.some((s: any) => s.id === moveTo) ? moveTo : stages.find((s: any) => s.id !== id)!.id
    const { error: moveError } = await db.from('leads').update({ pipeline_stage_id: target }).eq('organization_id', organizationId).eq('pipeline_stage_id', id)
    if (moveError) throw new Error(moveError.message)
    const { error } = await db.from('pipeline_stages').delete().eq('organization_id', organizationId).eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true, stages: await stagesWithCounts(db, organizationId) })
  } catch (error) {
    return serverError('delete stage', error)
  }
}

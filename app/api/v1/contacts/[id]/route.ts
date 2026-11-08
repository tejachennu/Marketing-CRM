import { NextResponse } from 'next/server'
import { apiAuth, apiError, jsonBody } from '@/lib/public-api/auth'
import { getContact, parseContactInput, updateContact } from '@/lib/public-api/contacts'
import { isUuid } from '@/lib/salon/validate'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

// GET /api/v1/contacts/{id}
export async function GET(request: Request, { params }: Params) {
  const auth = await apiAuth(request, 'contacts:read')
  if (!auth.ok) return auth.response
  const { id } = await params
  if (!isUuid(id)) return apiError(404, 'not_found', 'No contact with that id.')
  const contact = await getContact(auth.ctx.db, auth.ctx.organizationId, id).catch(() => null)
  return contact ? NextResponse.json({ data: contact }) : apiError(404, 'not_found', 'No contact with that id.')
}

// PATCH /api/v1/contacts/{id}: change the fields sent (tags replace the list)
export async function PATCH(request: Request, { params }: Params) {
  const auth = await apiAuth(request, 'contacts:write')
  if (!auth.ok) return auth.response
  const { id } = await params
  if (!isUuid(id)) return apiError(404, 'not_found', 'No contact with that id.')
  const read = await jsonBody(request)
  if ('response' in read) return read.response
  const parsed = parseContactInput(read.body, true)
  if ('error' in parsed) return apiError(400, 'invalid_request', parsed.error, { field: parsed.field })
  try {
    const result = await updateContact(auth.ctx.db, auth.ctx.organizationId, id, parsed.value)
    if (result.error === 'not_found') return apiError(404, 'not_found', 'No contact with that id.')
    if (result.error === 'phone_taken') return apiError(409, 'phone_taken', 'Another contact already has that phone number.', { field: 'phone' })
    return NextResponse.json({ data: result.contact })
  } catch (error: any) {
    console.error('[API contacts]', error?.message)
    return apiError(500, 'server_error', 'The contact could not be saved. Please try again.')
  }
}

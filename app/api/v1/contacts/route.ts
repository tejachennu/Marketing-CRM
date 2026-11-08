import { NextResponse } from 'next/server'
import { apiAuth, apiError, jsonBody, listResponse, paging } from '@/lib/public-api/auth'
import { listContacts, parseContactInput, upsertContact } from '@/lib/public-api/contacts'

export const runtime = 'nodejs'

// GET /api/v1/contacts?search=&phone=&tag=&limit=&offset=: contacts, newest first
export async function GET(request: Request) {
  const auth = await apiAuth(request, 'contacts:read')
  if (!auth.ok) return auth.response
  const params = new URL(request.url).searchParams
  const page = paging(params)
  try {
    return listResponse(await listContacts(auth.ctx.db, auth.ctx.organizationId, params, page), page)
  } catch (error: any) {
    console.error('[API contacts]', error?.message)
    return apiError(500, 'server_error', 'The contacts could not be read. Please try again.')
  }
}

// POST /api/v1/contacts: create a contact, or update the one with the same phone number
export async function POST(request: Request) {
  const auth = await apiAuth(request, 'contacts:write')
  if (!auth.ok) return auth.response
  const read = await jsonBody(request)
  if ('response' in read) return read.response
  const parsed = parseContactInput(read.body)
  if ('error' in parsed) return apiError(400, 'invalid_request', parsed.error, { field: parsed.field })
  try {
    const { contact, created } = await upsertContact(auth.ctx.db, auth.ctx.organizationId, parsed.value)
    return NextResponse.json({ data: contact, created }, { status: created ? 201 : 200 })
  } catch (error: any) {
    console.error('[API contacts]', error?.message)
    return apiError(500, 'server_error', 'The contact could not be saved. Please try again.')
  }
}

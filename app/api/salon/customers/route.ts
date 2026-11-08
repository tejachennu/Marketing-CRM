import { NextRequest, NextResponse } from 'next/server'
import { findCustomers } from '@/lib/salon/customers'
import { salonAccess, serverError } from '@/lib/salon/server'

export const runtime = 'nodejs'

// GET ?organizationId&q=: saved customers matching part of a mobile number or a name, with their last visit
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await salonAccess(request, params.get('organizationId'))
  if (!access.ok) return access.response
  const { db, organizationId } = access.ctx
  try {
    return NextResponse.json({ success: true, customers: await findCustomers(db, organizationId, params.get('q')) })
  } catch (error) {
    return serverError('customers', error)
  }
}

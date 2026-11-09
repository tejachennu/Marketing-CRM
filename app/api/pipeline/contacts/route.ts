import { NextRequest, NextResponse } from 'next/server'
import { pipelineAccess, serverError } from '@/lib/pipeline/server'
import { customerSearch } from '@/lib/salon/customers'
import { phoneKey } from '@/lib/salon/spoken'

export const runtime = 'nodejs'

// GET ?organizationId&q: up to 8 saved contacts matching part of a number or a name, for a new deal
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const access = await pipelineAccess(request, params.get('organizationId'))
  if (!access.ok) return access.response
  const { db, organizationId } = access.ctx
  const search = customerSearch(params.get('q'))
  if (!search) return NextResponse.json({ success: true, contacts: [] })
  try {
    let query = db.from('contacts').select('id, first_name, last_name, phone_number, whatsapp_number, company').eq('organization_id', organizationId)
    if ('digits' in search) query = query.or(`phone_number.ilike.*${search.digits}*,whatsapp_number.ilike.*${search.digits}*`)
    else if (search.words.length > 1) query = query.ilike('first_name', `${search.words[0]}%`).ilike('last_name', `${search.words[1]}%`)
    else query = query.or(`first_name.ilike.${search.words[0]}*,last_name.ilike.${search.words[0]}*,company.ilike.*${search.words[0]}*`)
    const { data, error } = await query.limit(8)
    if (error) throw new Error(error.message)
    const contacts = (data || []).map((c: any) => {
      const phone = c.phone_number || String(c.whatsapp_number || '').replace(/^whatsapp:/, '') || null
      return {
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || phone || 'Contact',
        phone,
        company: c.company || null,
        exact: 'digits' in search && search.digits.length >= 10 && [c.phone_number, c.whatsapp_number].some((n: string) => n && phoneKey(n) === search.digits.slice(-10)),
      }
    }).sort((a: any, b: any) => Number(b.exact) - Number(a.exact) || a.name.localeCompare(b.name))
    return NextResponse.json({ success: true, contacts })
  } catch (error) {
    return serverError('contacts', error)
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'

export async function GET(request: NextRequest) {
  const isSuperAdmin = await checkSuperAdmin(request)
  if (!isSuperAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getSupabaseAdminClient()
    const { data: orgs, error } = await supabase
      .from('organizations')
      .select('*')
      .order('name', { ascending: true })

    if (error) throw error

    return NextResponse.json({ success: true, organizations: orgs || [] })
  } catch (error: any) {
    console.error('[SuperAdmin Orgs API GET] Error:', error)
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const isSuperAdmin = await checkSuperAdmin(request)
  if (!isSuperAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getSupabaseAdminClient()
    const body = await request.json()
    const { name, slug } = body

    if (!name || !slug) {
      return NextResponse.json({ error: 'Name and Slug are required' }, { status: 400 })
    }

    // Verify slug uniqueness
    const { data: existingOrg } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()

    if (existingOrg) {
      return NextResponse.json({ error: 'Organization slug must be unique' }, { status: 400 })
    }

    // Create organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert([
        {
          name,
          slug,
          contact_name: body.contact_name || null,
          contact_email: body.contact_email || null,
          contact_phone: body.contact_phone || null,
          contact_address: body.contact_address || null,
          enable_ai: body.enable_ai !== false,
          enable_email: body.enable_email !== false,
          enable_messages: body.enable_messages !== false,
          enable_phone_calls: body.enable_phone_calls !== false,
          enable_sms: body.enable_sms !== false,
          twilio_account_sid: body.twilio_account_sid || null,
          twilio_auth_token: body.twilio_auth_token || null,
          twilio_whatsapp_number: body.twilio_whatsapp_number || null,
          sendgrid_api_key: body.sendgrid_api_key || null,
          sendgrid_from_email: body.sendgrid_from_email || null,
          openai_api_key: body.openai_api_key || null,
          chatbot_base_prompt: body.chatbot_base_prompt || null,
        },
      ])
      .select()
      .single()

    if (orgError) throw orgError

    // Create default pipeline stages
    await supabase.from('pipeline_stages').insert([
      { organization_id: org.id, name: 'New', position: 1, color: '#6366f1' },
      { organization_id: org.id, name: 'Contacted', position: 2, color: '#8b5cf6' },
      { organization_id: org.id, name: 'Qualified', position: 3, color: '#ec4899' },
      { organization_id: org.id, name: 'Negotiating', position: 4, color: '#f59e0b' },
      { organization_id: org.id, name: 'Closed Won', position: 5, color: '#10b981' },
    ])

    return NextResponse.json({ success: true, organization: org })
  } catch (error: any) {
    console.error('[SuperAdmin Orgs API POST] Error:', error)
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}

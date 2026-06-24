import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const isSuperAdmin = await checkSuperAdmin(request)
  if (!isSuperAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const supabase = getSupabaseAdminClient()
    const body = await request.json()

    // Filter to allowed keys for update
    const allowedKeys = [
      'name',
      'slug',
      'contact_name',
      'contact_email',
      'contact_phone',
      'contact_address',
      'enable_ai',
      'enable_email',
      'enable_messages',
      'enable_phone_calls',
      'enable_sms',
      'twilio_account_sid',
      'twilio_auth_token',
      'twilio_whatsapp_number',
      'sendgrid_api_key',
      'sendgrid_from_email',
      'openai_api_key',
      'chatbot_base_prompt',
      'email_provider',
      'smtp_host',
      'smtp_port',
      'smtp_email',
      'smtp_password',
      'whatsapp_provider',
      'whatsapp_api_token',
      'whatsapp_default_phone',
      'whatsapp_graph_api_version',
      'whatsapp_phone_number_id',
      'whatsapp_business_account_id',
    ]

    const updateData: Record<string, any> = {}
    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        updateData[key] = body[key]
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid update fields provided' }, { status: 400 })
    }

    // Verify slug uniqueness if it is changing
    if (updateData.slug) {
      const { data: existingOrg } = await supabase
        .from('organizations')
        .select('id')
        .eq('slug', updateData.slug)
        .neq('id', id)
        .maybeSingle()

      if (existingOrg) {
        return NextResponse.json({ error: 'Organization slug must be unique' }, { status: 400 })
      }
    }

    const { data: org, error } = await supabase
      .from('organizations')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, organization: org })
  } catch (error: any) {
    console.error('[SuperAdmin Org Update API] Error:', error)
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const isSuperAdmin = await checkSuperAdmin(request)
  if (!isSuperAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const supabase = getSupabaseAdminClient()

    // Delete organization record (related records cascade delete)
    const { error } = await supabase
      .from('organizations')
      .delete()
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true, message: 'Organization deleted successfully' })
  } catch (error: any) {
    console.error('[SuperAdmin Org Delete API] Error:', error)
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'
import { MASTER_ORG_ID } from '@/lib/constants'
import { isUuid } from '@/lib/record-visibility'

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/

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

    if (updateData.name !== undefined && !String(updateData.name).trim()) {
      return NextResponse.json({ error: 'Organization name cannot be empty' }, { status: 400 })
    }
    // Only a slug that is actually changing is checked, so organizations created with an older slug format still save
    if (updateData.slug !== undefined) {
      const { data: current } = await supabase.from('organizations').select('slug').eq('id', id).maybeSingle()
      if (updateData.slug === current?.slug) {
        delete updateData.slug
      } else if (!updateData.slug || !SLUG_PATTERN.test(String(updateData.slug))) {
        return NextResponse.json({ error: 'Slug may only contain lowercase letters, numbers and hyphens' }, { status: 400 })
      }
    }
    if (Object.keys(updateData).length === 0) {
      const { data: unchanged } = await supabase.from('organizations').select('*').eq('id', id).maybeSingle()
      return NextResponse.json({ success: true, organization: unchanged })
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
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid organization id' }, { status: 400 })
  }
  // Deleting either of these would remove the platform's own accounts, including the caller's
  if (id === MASTER_ORG_ID) {
    return NextResponse.json({ error: 'The platform organization cannot be deleted.' }, { status: 400 })
  }
  if (id === isSuperAdmin.organization_id) {
    return NextResponse.json({ error: 'You cannot delete the organization your own account belongs to.' }, { status: 400 })
  }

  try {
    const supabase = getSupabaseAdminClient()

    // The members' logins live outside the organization's tables, so collect them before the cascade removes the profiles
    const { data: members } = await supabase.from('users').select('id').eq('organization_id', id)

    // Delete organization record (related records cascade delete)
    const { error } = await supabase
      .from('organizations')
      .delete()
      .eq('id', id)

    if (error) throw error

    // Remove the logins too. Left behind, each one could sign in again and would be given a fresh workspace.
    let loginsNotRemoved = 0
    for (const member of members || []) {
      const { error: authError } = await supabase.auth.admin.deleteUser(member.id)
      if (authError) {
        loginsNotRemoved += 1
        console.warn('[SuperAdmin Org Delete API] Could not delete login for user', member.id, authError.message)
      }
    }

    return NextResponse.json({ success: true, message: 'Organization deleted successfully', loginsNotRemoved })
  } catch (error: any) {
    console.error('[SuperAdmin Org Delete API] Error:', error)
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseAdminClient()
    const { data: teammates, error } = await supabase
      .from('users')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ success: true, teammates })
  } catch (error: any) {
    console.error('[API] Get teammates error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to retrieve teammates' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, fullName, role, organizationId } = body

    if (!email || !fullName || !role || !organizationId) {
      return NextResponse.json({ error: 'All fields (email, name, role) are required' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseAdminClient()

    // 1. Fetch organization limit
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('name, max_teammates')
      .eq('id', organizationId)
      .single()

    if (orgError) throw orgError

    const limit = orgData?.max_teammates && orgData.max_teammates > 0 ? orgData.max_teammates : 4

    // 2. Fetch current teammate count
    const { count, error: countError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)

    if (countError) throw countError

    if (count !== null && count >= limit) {
      return NextResponse.json(
        { error: `Teammate limit reached. Your organization is limited to ${limit} teammates.` },
        { status: 400 }
      )
    }

    // Generate a secure random password so they cannot log in until they set it
    const randomPassword = require('crypto').randomBytes(24).toString('hex') + 'A1!'

    // 3. Create auth user in Supabase
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: randomPassword,
      email_confirm: true,
    })

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    // 4. Create user profile in public.users
    const { data: newProfile, error: profileError } = await supabase
      .from('users')
      .insert([
        {
          id: authData.user.id,
          organization_id: organizationId,
          email,
          full_name: fullName,
          role,
        },
      ])
      .select()
      .single()

    if (profileError) {
      // Rollback auth user
      await supabase.auth.admin.deleteUser(authData.user.id)
      throw profileError
    }

    // 5. Generate secure password setup token
    const token = require('crypto').randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours validity

    const { error: tokenError } = await supabase
      .from('password_setup_tokens')
      .insert([
        {
          user_id: authData.user.id,
          token,
          expires_at: expiresAt,
        }
      ])

    if (tokenError) {
      console.error('[API] Failed to store setup token:', tokenError)
      // Note: We don't fail teammate creation if token fails, but it is critical.
    } else {
      // 6. Send Invitation Email with Setup Link
      const origin = request.headers.get('origin') || 'http://localhost:3000'
      const setupLink = `${origin}/set-password?token=${token}`
      const orgName = orgData?.name || 'Your Company'

      const inviteHtml = `
        <div style="font-family: sans-serif; max-width: 550px; margin: 0 auto; padding: 24px; border: 1px solid #e9edef; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="height: 48px; width: 48px; border-radius: 12px; background: linear-gradient(135deg, #00a884, #3b82f6); display: inline-block; line-height: 48px; color: white; font-weight: 900; font-size: 20px;">OM</div>
            <h2 style="color: #111b21; font-weight: 800; font-size: 22px; margin-top: 16px; margin-bottom: 4px;">Welcome to ${orgName}!</h2>
            <p style="color: #667781; font-size: 13px; margin: 0;">You have been invited to join the OmniCRM workspace.</p>
          </div>
          <div style="border-top: 1px solid #e9edef; border-bottom: 1px solid #e9edef; padding: 20px 0; margin-bottom: 24px;">
            <p style="color: #111b21; font-size: 13px; font-weight: 700; margin-bottom: 8px;">Workspace Role:</p>
            <p style="color: #00a884; font-size: 13px; font-weight: 800; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">${role.replace('_', ' ')}</p>
            <p style="color: #54656f; font-size: 12px; line-height: 1.6; margin-top: 16px; margin-bottom: 0;">
              Before you can access your account, you need to set up a password. Please click the button below to secure your account. This link will expire in 24 hours.
            </p>
          </div>
          <div style="text-align: center; margin-bottom: 24px;">
            <a href="${setupLink}" style="background-color: #00a884; color: #ffffff; padding: 12px 28px; border-radius: 10px; font-weight: 800; font-size: 13px; text-decoration: none; display: inline-block; box-shadow: 0 4px 10px rgba(0, 168, 132, 0.15); transition: background 0.2s;">
              Set Up Password
            </a>
          </div>
          <p style="color: #8696a0; font-size: 10px; line-height: 1.4; margin-top: 24px; border-top: 1px solid #e9edef; pt: 16px;">
            If the button doesn't work, copy and paste this link in your browser:<br/>
            <a href="${setupLink}" style="color: #3b82f6; text-decoration: underline;">${setupLink}</a>
          </p>
        </div>
      `

      const { sendEmail } = require('@/lib/email')
      try {
        await sendEmail({
          to: email.trim().toLowerCase(),
          subject: `✉️ Setup your password for ${orgName} on OmniCRM`,
          html: inviteHtml,
          text: `Welcome to ${orgName}! Click here to set up your password: ${setupLink}`
        })
      } catch (err) {
        console.error('[API] Failed to send invitation email:', err)
      }
    }

    return NextResponse.json({ success: true, teammate: newProfile })
  } catch (error: any) {
    console.error('[API] Add teammate error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to add teammate' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const orgId = searchParams.get('organizationId')

    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseAdminClient()

    // Enforce that we don't delete the last owner/admin of the organization
    const { count, error: countError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)

    if (countError) throw countError

    if (count !== null && count <= 1) {
      return NextResponse.json({ error: 'Cannot delete the last user in the organization.' }, { status: 400 })
    }

    // Delete user profile first
    const { error: profileError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId)
      .eq('organization_id', orgId)

    if (profileError) throw profileError

    // Delete auth user
    const { error: authError } = await supabase.auth.admin.deleteUser(userId)
    if (authError) {
      console.warn('Auth user deletion failed:', authError.message)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[API] Delete teammate error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete teammate' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, organizationId, seeAll, readOnly } = body

    if (!userId || !organizationId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseAdminClient()

    const updateFields: any = {}
    if (seeAll !== undefined) updateFields.see_all = seeAll
    if (readOnly !== undefined) updateFields.read_only = readOnly

    const { data: updatedTeammate, error } = await supabase
      .from('users')
      .update(updateFields)
      .eq('id', userId)
      .eq('organization_id', organizationId)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, teammate: updatedTeammate })
  } catch (error: any) {
    console.error('[API] Update teammate error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update teammate' },
      { status: 500 }
    )
  }
}

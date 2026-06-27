import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json()

    if (!token || !password) {
      return NextResponse.json(
        { error: 'Token and password are required' },
        { status: 400 }
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters long' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdminClient()
    const now = new Date().toISOString()

    // 1. Find the token in the database
    const { data: tokenRecords, error: tokenError } = await supabase
      .from('password_setup_tokens')
      .select('*')
      .eq('token', token)
      .gt('expires_at', now)
      .limit(1)

    if (tokenError) {
      console.error('[Set Password API] DB error checking token:', tokenError)
      return NextResponse.json({ error: 'Failed to verify token' }, { status: 500 })
    }

    if (!tokenRecords || tokenRecords.length === 0) {
      return NextResponse.json(
        { error: 'Invalid or expired setup token. Please request another invite.' },
        { status: 400 }
      )
    }

    const tokenRecord = tokenRecords[0]

    // 2. Update Supabase Auth user password
    const { error: authUpdateError } = await supabase.auth.admin.updateUserById(
      tokenRecord.user_id,
      { password }
    )

    if (authUpdateError) {
      console.error('[Set Password API] Supabase auth update error:', authUpdateError)
      return NextResponse.json(
        { error: authUpdateError.message },
        { status: 400 }
      )
    }

    // 3. Delete setup token
    await supabase
      .from('password_setup_tokens')
      .delete()
      .eq('token', token)

    return NextResponse.json({ success: true, message: 'Password set successfully!' })
  } catch (error: any) {
    console.error('[Set Password API] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to set password' },
      { status: 500 }
    )
  }
}

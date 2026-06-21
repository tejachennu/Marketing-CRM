import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables')
  }

  // Use service role to bypass RLS and rate limits
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient()
    const { email, password, fullName, companyName } = await request.json()

    if (!email || !password || !fullName || !companyName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Create organization first
    const slug = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .insert([
        {
          name: companyName,
          slug: `${slug}-${randomBytes(4).toString('hex')}`,
        },
      ])
      .select()
      .single()

    if (orgError) throw orgError

    // Create auth user via Supabase
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Skip email verification
    })

    if (authError) throw authError

    // Create user profile
    const { error: userError } = await supabase.from('users').insert([
      {
        id: authData.user.id,
        organization_id: orgData.id,
        email,
        full_name: fullName,
        role: 'owner',
      },
    ])

    if (userError) throw userError

    // Create demo data
    const { data: stagesData } = await supabase
      .from('pipeline_stages')
      .insert([
        { organization_id: orgData.id, name: 'New', position: 1, color: '#6366f1' },
        { organization_id: orgData.id, name: 'Contacted', position: 2, color: '#8b5cf6' },
        { organization_id: orgData.id, name: 'Qualified', position: 3, color: '#ec4899' },
        { organization_id: orgData.id, name: 'Negotiating', position: 4, color: '#f59e0b' },
        { organization_id: orgData.id, name: 'Closed Won', position: 5, color: '#10b981' },
      ])
      .select()

    // Create demo contacts
    const { data: contactsData } = await supabase
      .from('contacts')
      .insert([
        {
          organization_id: orgData.id,
          first_name: 'John',
          last_name: 'Smith',
          phone_number: '+16475523753',
          email: 'john@example.com',
          company: 'Tech Corp',
        },
        {
          organization_id: orgData.id,
          first_name: 'Sarah',
          last_name: 'Johnson',
          phone_number: '+14165551234',
          email: 'sarah@example.com',
          company: 'Innovation Inc',
        },
        {
          organization_id: orgData.id,
          first_name: 'Michael',
          last_name: 'Chen',
          phone_number: '+18005551234',
          email: 'michael@example.com',
          company: 'Digital Solutions',
        },
      ])
      .select()

    // Create demo leads
    if (contactsData) {
      await supabase.from('leads').insert([
        {
          organization_id: orgData.id,
          contact_id: contactsData[0].id,
          title: 'Enterprise License',
          description: 'Interested in annual enterprise plan',
          pipeline_stage_id: stagesData?.[0]?.id,
          value: 5000,
          priority: 'high',
        },
        {
          organization_id: orgData.id,
          contact_id: contactsData[1].id,
          title: 'SaaS Subscription',
          description: 'Looking for cloud-based solution',
          pipeline_stage_id: stagesData?.[0]?.id,
          value: 10000,
          priority: 'medium',
        },
        {
          organization_id: orgData.id,
          contact_id: contactsData[2].id,
          title: 'Integration Services',
          description: 'Need API integration support',
          pipeline_stage_id: stagesData?.[0]?.id,
          value: 7500,
          priority: 'high',
        },
      ])

      // Create demo conversations
      const { data: convsData } = await supabase
        .from('conversations')
        .insert([
          {
            organization_id: orgData.id,
            contact_id: contactsData[0].id,
            is_active: true,
          },
          {
            organization_id: orgData.id,
            contact_id: contactsData[1].id,
            is_active: true,
          },
          {
            organization_id: orgData.id,
            contact_id: contactsData[2].id,
            is_active: true,
          },
        ])
        .select()

      // Create demo messages
      if (convsData) {
        await supabase.from('messages').insert([
          {
            organization_id: orgData.id,
            conversation_id: convsData[0].id,
            sender_type: 'contact',
            body: 'Hi! I am interested in your services.',
            created_at: new Date(Date.now() - 3600000).toISOString(),
          },
          {
            organization_id: orgData.id,
            conversation_id: convsData[0].id,
            sender_type: 'user',
            body: 'Thank you for reaching out! How can I help you today?',
            created_at: new Date(Date.now() - 3000000).toISOString(),
          },
          {
            organization_id: orgData.id,
            conversation_id: convsData[0].id,
            sender_type: 'contact',
            body: 'I would like to learn more about your pricing.',
            created_at: new Date(Date.now() - 2400000).toISOString(),
          },
          {
            organization_id: orgData.id,
            conversation_id: convsData[1].id,
            sender_type: 'contact',
            body: 'Hello, are you available?',
            created_at: new Date(Date.now() - 1800000).toISOString(),
          },
          {
            organization_id: orgData.id,
            conversation_id: convsData[1].id,
            sender_type: 'user',
            body: 'Yes, I am here. What can I do for you?',
            created_at: new Date(Date.now() - 1200000).toISOString(),
          },
          {
            organization_id: orgData.id,
            conversation_id: convsData[2].id,
            sender_type: 'contact',
            body: 'Can you help me with integration?',
            created_at: new Date(Date.now() - 600000).toISOString(),
          },
        ])
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Account created successfully',
        user: {
          id: authData.user.id,
          email: authData.user.email,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[v0] Signup error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Signup failed',
      },
      { status: 400 }
    )
  }
}

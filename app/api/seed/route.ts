import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Get or create test user via service role
    const testEmail = `demo-${Date.now()}@test.local`
    const testPassword = 'Demo123456!'

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    })

    if (authError) throw authError
    if (!authData.user) throw new Error('Failed to create user')

    // Create organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert([
        {
          name: 'Demo Company',
          slug: `demo-${Date.now()}`,
        },
      ])
      .select()
      .single()

    if (orgError) throw orgError

    // Create user profile
    const { error: userError } = await supabase.from('users').insert([
      {
        id: authData.user.id,
        organization_id: org.id,
        email: testEmail,
        full_name: 'Demo User',
        role: 'owner',
      },
    ])

    if (userError) throw userError

    // Create pipeline stages
    const stages = [
      { name: 'New', color: '#3b82f6', position: 0 },
      { name: 'Contacted', color: '#8b5cf6', position: 1 },
      { name: 'Qualified', color: '#ec4899', position: 2 },
      { name: 'Negotiating', color: '#f59e0b', position: 3 },
      { name: 'Closed', color: '#10b981', position: 4 },
    ]

    for (const stage of stages) {
      await supabase.from('pipeline_stages').insert([
        {
          organization_id: org.id,
          ...stage,
        },
      ])
    }

    // Create demo contacts
    const contacts = [
      {
        phone_number: '+16475523753',
        whatsapp_number: 'whatsapp:+16475523753',
        first_name: 'John',
        last_name: 'Smith',
        email: 'john@example.com',
        company: 'Tech Corp',
      },
      {
        phone_number: '+14165551234',
        whatsapp_number: 'whatsapp:+14165551234',
        first_name: 'Sarah',
        last_name: 'Johnson',
        email: 'sarah@example.com',
        company: 'Innovation Labs',
      },
      {
        phone_number: '+18005551234',
        whatsapp_number: 'whatsapp:+18005551234',
        first_name: 'Michael',
        last_name: 'Chen',
        email: 'michael@example.com',
        company: 'Digital Solutions',
      },
    ]

    const { data: contactData, error: contactError } = await supabase
      .from('contacts')
      .insert(
        contacts.map((c) => ({
          ...c,
          organization_id: org.id,
          created_by: authData.user.id,
        }))
      )
      .select()

    if (contactError) throw contactError

    // Create demo leads
    const { data: stagesData } = await supabase
      .from('pipeline_stages')
      .select()
      .eq('organization_id', org.id)
      .order('position')

    if (contactData && stagesData && stagesData.length > 0) {
      const leads = contactData.map((contact, index) => ({
        organization_id: org.id,
        contact_id: contact.id,
        pipeline_stage_id: stagesData[0].id,
        title: `Lead - ${contact.first_name} ${contact.last_name}`,
        description: `Potential customer from ${contact.company}`,
        value: (index + 1) * 5000,
        priority: ['high', 'medium', 'low'][index % 3],
        created_by: authData.user.id,
      }))

      await supabase.from('leads').insert(leads)

      // Create demo conversations with messages
      for (const contact of contactData) {
        const { data: conversation, error: convError } = await supabase
          .from('conversations')
          .insert([
            {
              organization_id: org.id,
              contact_id: contact.id,
              is_active: true,
              assigned_to: authData.user.id,
            },
          ])
          .select()
          .single()

        if (convError) throw convError
        if (conversation) {
          const messages = [
            {
              body: 'Hi! I am interested in your services.',
              sender_type: 'contact',
            },
            {
              body: 'Thank you for reaching out! How can I help you today?',
              sender_type: 'user',
              sender_id: authData.user.id,
            },
            {
              body: 'I would like to learn more about your pricing.',
              sender_type: 'contact',
            },
          ]

          for (let i = 0; i < messages.length; i++) {
            await supabase.from('messages').insert([
              {
                organization_id: org.id,
                conversation_id: conversation.id,
                ...messages[i],
                created_at: new Date(Date.now() - (3 - i) * 60000).toISOString(),
              },
            ])
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      email: testEmail,
      password: testPassword,
      organizationId: org.id,
      userId: authData.user.id,
      message: 'Demo data seeded successfully!',
    })
  } catch (error) {
    console.error('[v0] Seed error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to seed data',
      },
      { status: 500 }
    )
  }
}

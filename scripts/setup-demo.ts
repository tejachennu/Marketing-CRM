import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

async function setupDemo() {
  console.log('🚀 Setting up demo data...')

  try {
    // Create test organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert([
        {
          name: 'Demo CRM Company',
          slug: 'demo-crm',
        },
      ])
      .select()
      .single()

    if (orgError) throw orgError
    console.log('✅ Created organization:', org.name)

    // Create pipeline stages
    const stages = ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Closed']
    const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981']

    const stagePromises = stages.map((stage, index) =>
      supabase
        .from('pipeline_stages')
        .insert([
          {
            organization_id: org.id,
            name: stage,
            color: colors[index],
            position: index,
          },
        ])
        .select()
        .single()
    )

    const stageResults = await Promise.all(stagePromises)
    console.log('✅ Created', stageResults.length, 'pipeline stages')

    // Create demo contacts
    const contacts = [
      {
        phone_number: '+16475523753',
        first_name: 'Sarah',
        last_name: 'Johnson',
        email: 'sarah@example.com',
        company: 'Tech Startup Inc',
      },
      {
        phone_number: '+14165551234',
        first_name: 'Michael',
        last_name: 'Chen',
        email: 'michael@example.com',
        company: 'Enterprise Solutions',
      },
      {
        phone_number: '+13105559876',
        first_name: 'Emma',
        last_name: 'Williams',
        email: 'emma@example.com',
        company: 'Digital Marketing Co',
      },
    ]

    const contactPromises = contacts.map((contact) =>
      supabase
        .from('contacts')
        .insert([
          {
            organization_id: org.id,
            phone_number: contact.phone_number,
            whatsapp_number: `whatsapp:${contact.phone_number}`,
            first_name: contact.first_name,
            last_name: contact.last_name,
            email: contact.email,
            company: contact.company,
          },
        ])
        .select()
        .single()
    )

    const contactResults = await Promise.all(contactPromises)
    console.log('✅ Created', contactResults.length, 'demo contacts')

    // Create demo conversations
    const convPromises = contactResults.map((contactRes) => {
      const contact = (contactRes as any).data
      return supabase
        .from('conversations')
        .insert([
          {
            organization_id: org.id,
            contact_id: contact.id,
            is_active: true,
            last_message_at: new Date().toISOString(),
          },
        ])
        .select()
        .single()
    })

    const convResults = await Promise.all(convPromises)
    console.log('✅ Created', convResults.length, 'demo conversations')

    // Add demo messages
    const messagePromises = convResults.map((convRes) => {
      const conversation = (convRes as any).data
      const messages = [
        { body: 'Hi, I&apos;m interested in learning more about your services.', sender_type: 'contact' },
        { body: 'Great! I&apos;d love to help. What are your specific needs?', sender_type: 'user' },
        { body: 'We&apos;re looking for a solution to streamline our sales process.', sender_type: 'contact' },
      ]

      return Promise.all(
        messages.map((msg, index) =>
          supabase.from('messages').insert([
            {
              organization_id: org.id,
              conversation_id: conversation.id,
              sender_type: msg.sender_type,
              body: msg.body,
              created_at: new Date(Date.now() - (3 - index) * 60000).toISOString(),
            },
          ])
        )
      )
    })

    await Promise.all(messagePromises)
    console.log('✅ Created demo messages')

    console.log('\n✨ Demo data setup complete!')
    console.log('Organization ID:', org.id)
    console.log('\nYou can now:')
    console.log('1. Sign up with a test email')
    console.log('2. Link this organization in Settings')
    console.log('3. See demo conversations and messages')
  } catch (error) {
    console.error('❌ Error setting up demo data:', error)
    process.exit(1)
  }
}

setupDemo()

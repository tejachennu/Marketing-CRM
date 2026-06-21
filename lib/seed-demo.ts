import { supabase } from './supabase'

export async function seedDemoData() {
  try {
    console.log('[v0] Starting demo data seed...')

    // Create organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert([{ name: 'Demo Company', slug: 'demo-company' }])
      .select()
      .single()

    if (orgError) throw orgError
    console.log('[v0] Created organization:', org.id)

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No user logged in')

    // Create user profile if doesn't exist
    const { data: existingUser } = await supabase
      .from('users')
      .select()
      .eq('id', user.id)
      .single()

    if (!existingUser) {
      const { error: userError } = await supabase.from('users').insert([
        {
          id: user.id,
          organization_id: org.id,
          email: user.email!,
          full_name: 'Demo User',
          role: 'owner',
        },
      ])
      if (userError) throw userError
      console.log('[v0] Created user profile')
    }

    // Create default pipeline stages
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
    console.log('[v0] Created pipeline stages')

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

    const { data: contactData } = await supabase
      .from('contacts')
      .insert(
        contacts.map((c) => ({
          ...c,
          organization_id: org.id,
          created_by: user.id,
        }))
      )
      .select()

    console.log('[v0] Created demo contacts')

    if (contactData && contactData.length > 0) {
      // Get first pipeline stage
      const { data: stages } = await supabase
        .from('pipeline_stages')
        .select()
        .eq('organization_id', org.id)
        .order('position')
        .limit(1)

      if (stages && stages.length > 0) {
        // Create demo leads
        const leads = contactData.map((contact: any, index: number) => ({
          organization_id: org.id,
          contact_id: contact.id,
          pipeline_stage_id: stages[0].id,
          title: `Lead - ${contact.first_name} ${contact.last_name}`,
          description: `Potential customer from ${contact.company}`,
          value: (index + 1) * 5000,
          priority: ['high', 'medium', 'low'][index % 3] as 'high' | 'medium' | 'low',
          created_by: user.id,
        }))

        await supabase.from('leads').insert(leads)
        console.log('[v0] Created demo leads')

        // Create demo conversations
        for (const contact of contactData) {
          const { data: conversation } = await supabase
            .from('conversations')
            .insert([
              {
                organization_id: org.id,
                contact_id: contact.id,
                is_active: true,
                assigned_to: user.id,
              },
            ])
            .select()
            .single()

          if (conversation) {
            // Add demo messages
            const messages = [
              {
                body: 'Hi! I am interested in your services.',
                sender_type: 'contact',
              },
              {
                body: 'Thank you for reaching out! How can I help you today?',
                sender_type: 'user',
                sender_id: user.id,
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
        console.log('[v0] Created demo conversations and messages')
      }
    }

    console.log('[v0] Demo data seed completed successfully!')
    return { success: true, organizationId: org.id }
  } catch (error) {
    console.error('[v0] Demo data seed failed:', error)
    return { success: false, error }
  }
}

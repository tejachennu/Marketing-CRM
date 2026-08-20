import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

// GET: List contacts
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient()

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '20', 10)
    const search = searchParams.get('search') || ''
    const offset = (page - 1) * limit

    let query = supabase
      .from('contacts')
      .select('*', { count: 'exact' })

    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone_number.ilike.%${search}%,company.ilike.%${search}%`)
    }

    const { data: contacts, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    return NextResponse.json({
      success: true,
      contacts: contacts || [],
      count: count || 0,
      page,
      limit,
      hasMore: (count || 0) > offset + (contacts?.length || 0),
    })
  } catch (error) {
    console.error('[API] List contacts error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to list contacts',
      },
      { status: 500 }
    )
  }
}

// POST: Create contact + Auto-create conversation
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient()
    const body = await request.json()
    const {
      organizationId,
      firstName,
      lastName,
      phoneNumber,
      email,
      company,
      tags
    } = body

    if (!organizationId) {
      return NextResponse.json(
        { error: 'Organization ID is required' },
        { status: 400 }
      )
    }

    if (!phoneNumber) {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400 }
      )
    }

    const normalizedPhone = phoneNumber.replace(/[\s-()]/g, '')

    // Check if contact already exists globally
    const { data: existing, error: existingError } = await supabase
      .from('contacts')
      .select('*')
      .eq('phone_number', normalizedPhone)
      .single()

    if (existingError && existingError.code !== 'PGRST116') {
      throw existingError
    }

    // Format tags properly
    let parsedTags: string[] = []
    if (Array.isArray(tags)) {
      parsedTags = tags.map(t => String(t).trim()).filter(Boolean)
    } else if (typeof tags === 'string' && tags.trim()) {
      parsedTags = tags.split(/[,;|]/).map(t => t.trim()).filter(Boolean)
    }

    if (existing) {
      // If contact already exists and new tags are provided, optionally merge tags
      if (parsedTags.length > 0) {
        const currentTags = Array.isArray(existing.tags) ? existing.tags : []
        const mergedTags = Array.from(new Set([...currentTags, ...parsedTags]))
        await supabase
          .from('contacts')
          .update({
            tags: mergedTags,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)
      }
      return NextResponse.json(
        { error: 'Contact with this phone number already exists', existingContact: existing },
        { status: 409 }
      )
    }

    // Insert contact
    const { data: contact, error: createError } = await supabase
      .from('contacts')
      .insert([
        {
          organization_id: organizationId,
          first_name: firstName || null,
          last_name: lastName || null,
          phone_number: normalizedPhone,
          email: email || null,
          company: company || null,
          tags: parsedTags,
        },
      ])
      .select()
      .single()

    if (createError) throw createError

    // Auto-create an active conversation for the new contact
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .insert([
        {
          organization_id: organizationId,
          contact_id: contact.id,
          is_active: true,
          last_message_at: new Date().toISOString(),
        },
      ])
      .select()
      .single()

    if (convError) {
      console.error('[API] Auto-create conversation error (continuing):', convError)
    }

    return NextResponse.json(
      {
        success: true,
        contact,
        conversation,
        message: 'Contact created successfully',
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[API] Create contact error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create contact',
      },
      { status: 500 }
    )
  }
}

// PUT: Update contact
export async function PUT(request: NextRequest) {
  try {
    const supabase = getSupabaseClient()
    const body = await request.json()
    const {
      id,
      organizationId,
      first_name,
      last_name,
      phone_number,
      email,
      company,
      tags
    } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Contact ID is required' },
        { status: 400 }
      )
    }

    if (!phone_number) {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400 }
      )
    }

    const normalizedPhone = phone_number.replace(/[\s-()]/g, '')

    // Check if another contact globally has this phone number
    const { data: existing, error: existingError } = await supabase
      .from('contacts')
      .select('*')
      .eq('phone_number', normalizedPhone)
      .neq('id', id)
      .single()

    if (existingError && existingError.code !== 'PGRST116') {
      throw existingError
    }

    if (existing) {
      return NextResponse.json(
        { error: 'Another contact with this phone number already exists' },
        { status: 409 }
      )
    }

    const updatePayload: any = {
      first_name: first_name || null,
      last_name: last_name || null,
      phone_number: normalizedPhone,
      email: email || null,
      company: company || null,
      updated_at: new Date().toISOString(),
    }

    if (tags !== undefined) {
      if (Array.isArray(tags)) {
        updatePayload.tags = tags.map(t => String(t).trim()).filter(Boolean)
      } else if (typeof tags === 'string') {
        updatePayload.tags = tags.split(/[,;|]/).map(t => t.trim()).filter(Boolean)
      }
    }

    const { data: contact, error: updateError } = await supabase
      .from('contacts')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw updateError

    return NextResponse.json({
      success: true,
      contact,
      message: 'Contact updated successfully',
    })
  } catch (error) {
    console.error('[API] Update contact error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update contact',
      },
      { status: 500 }
    )
  }
}

// DELETE: Delete contact
export async function DELETE(request: NextRequest) {
  try {
    const supabase = getSupabaseClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Contact ID is required' },
        { status: 400 }
      )
    }

    const { error: deleteError } = await supabase
      .from('contacts')
      .delete()
      .eq('id', id)

    if (deleteError) throw deleteError

    return NextResponse.json({
      success: true,
      message: 'Contact deleted successfully',
    })
  } catch (error) {
    console.error('[API] Delete contact error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to delete contact',
      },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess, verifyRecordAccess } from '@/lib/api-auth-helper'

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
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limitParam = searchParams.get('limit')
    const isAll = searchParams.get('all') === 'true' || limitParam === 'all' || limitParam === '0'
    const limit = isAll ? 50000 : parseInt(limitParam || '20', 10)
    const search = searchParams.get('search') || ''
    const tagFilter = searchParams.get('tag') || ''
    const offset = isAll ? 0 : (page - 1) * limit

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, orgId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()

    if (isAll) {
      // Fetch all contacts across batches of 1,000 to bypass PostgREST 1000 row cap
      let initialQuery = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .eq('organization_id', orgId)

      if (tagFilter) {
        initialQuery = initialQuery.contains('tags', [tagFilter])
      }

      if (search) {
        initialQuery = initialQuery.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone_number.ilike.%${search}%,company.ilike.%${search}%`)
      }

      const { data: firstBatch, count: totalCount, error: firstError } = await initialQuery
        .order('created_at', { ascending: false })
        .range(0, 999)

      if (firstError) throw firstError

      let allContacts = firstBatch || []
      const total = totalCount || allContacts.length

      if (total > 1000) {
        const batchSize = 1000
        const promises = []
        for (let batchOffset = 1000; batchOffset < total; batchOffset += batchSize) {
          let batchQuery = supabase
            .from('contacts')
            .select('*')
            .eq('organization_id', orgId)

          if (tagFilter) {
            batchQuery = batchQuery.contains('tags', [tagFilter])
          }

          if (search) {
            batchQuery = batchQuery.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone_number.ilike.%${search}%,company.ilike.%${search}%`)
          }

          promises.push(
            batchQuery
              .order('created_at', { ascending: false })
              .range(batchOffset, Math.min(batchOffset + batchSize - 1, total - 1))
          )
        }

        const results = await Promise.all(promises)
        for (const res of results) {
          if (res.data) {
            allContacts = allContacts.concat(res.data)
          }
        }
      }

      return NextResponse.json({
        success: true,
        contacts: allContacts,
        count: total,
        page: 1,
        limit: total,
        hasMore: false,
      })
    }

    let query = supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .eq('organization_id', orgId)

    if (tagFilter) {
      query = query.contains('tags', [tagFilter])
    }

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
    const body = await request.json()
    const {
      organizationId,
      firstName,
      lastName,
      phoneNumber,
      email,
      company,
      tags,
    } = body

    if (!organizationId) {
      return NextResponse.json(
        { error: 'Organization ID is required' },
        { status: 400 }
      )
    }

    const authResult = await verifyOrgAccess(request, organizationId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()

    if (!phoneNumber) {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400 }
      )
    }

    const normalizedPhone = phoneNumber.replace(/[\s-()]/g, '')

    // Check if contact already exists in this organization
    const { data: existing, error: existingError } = await supabase
      .from('contacts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('phone_number', normalizedPhone)
      .single()

    if (existingError && existingError.code !== 'PGRST116') {
      throw existingError
    }

    if (existing) {
      return NextResponse.json(
        { error: 'Contact with this phone number already exists' },
        { status: 409 }
      )
    }

    let formattedTags: string[] = []
    if (Array.isArray(tags)) {
      formattedTags = tags.map((t: any) => String(t).trim()).filter(Boolean)
    } else if (typeof tags === 'string' && tags.trim()) {
      formattedTags = tags.split(',').map((t: string) => t.trim()).filter(Boolean)
    }
    formattedTags = Array.from(new Set(formattedTags))

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
          tags: formattedTags,
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
    const body = await request.json()
    const {
      id,
      organizationId,
      first_name,
      last_name,
      phone_number,
      email,
      company,
      tags,
    } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Contact ID is required' },
        { status: 400 }
      )
    }

    const authResult = await verifyOrgAccess(request, organizationId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const recordResult = await verifyRecordAccess(request, 'contacts', id)
    if (!recordResult.authorized) {
      return NextResponse.json({ error: recordResult.error }, { status: recordResult.status })
    }

    const supabase = getSupabaseClient()

    if (!phone_number) {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400 }
      )
    }

    const normalizedPhone = phone_number.replace(/[\s-()]/g, '')

    // Check if another contact in this organization has this phone number
    const { data: existing, error: existingError } = await supabase
      .from('contacts')
      .select('*')
      .eq('organization_id', organizationId)
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

    let formattedTags: string[] | undefined = undefined
    if (tags !== undefined) {
      if (Array.isArray(tags)) {
        formattedTags = tags.map((t: any) => String(t).trim()).filter(Boolean)
      } else if (typeof tags === 'string') {
        formattedTags = tags.split(',').map((t: string) => t.trim()).filter(Boolean)
      } else {
        formattedTags = []
      }
      formattedTags = Array.from(new Set(formattedTags))
    }

    const updatePayload: any = {
      first_name: first_name || null,
      last_name: last_name || null,
      phone_number: normalizedPhone,
      email: email || null,
      company: company || null,
      updated_at: new Date().toISOString(),
    }

    if (formattedTags !== undefined) {
      updatePayload.tags = formattedTags
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

// PATCH: Add, remove, or set tags for a contact
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, action, tag, tags } = body

    if (!id) {
      return NextResponse.json({ error: 'Contact ID is required' }, { status: 400 })
    }

    const recordResult = await verifyRecordAccess(request, 'contacts', id)
    if (!recordResult.authorized) {
      return NextResponse.json({ error: recordResult.error }, { status: recordResult.status })
    }

    const supabase = getSupabaseClient()

    // Fetch current contact tags
    const { data: currentContact, error: fetchErr } = await supabase
      .from('contacts')
      .select('id, tags')
      .eq('id', id)
      .single()

    if (fetchErr) throw fetchErr

    const currentTags: string[] = Array.isArray(currentContact.tags) ? currentContact.tags : []
    let updatedTags: string[] = [...currentTags]

    if (action === 'add_tag') {
      const cleanTag = String(tag || '').trim()
      if (cleanTag && !updatedTags.includes(cleanTag)) {
        updatedTags.push(cleanTag)
      }
    } else if (action === 'remove_tag') {
      const cleanTag = String(tag || '').trim()
      updatedTags = updatedTags.filter(t => t !== cleanTag)
    } else if (action === 'set_tags' || tags !== undefined) {
      if (Array.isArray(tags)) {
        updatedTags = tags.map((t: any) => String(t).trim()).filter(Boolean)
      } else if (typeof tags === 'string') {
        updatedTags = tags.split(',').map((t: string) => t.trim()).filter(Boolean)
      }
    }

    updatedTags = Array.from(new Set(updatedTags))

    const { data: contact, error: updateError } = await supabase
      .from('contacts')
      .update({
        tags: updatedTags,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw updateError

    return NextResponse.json({
      success: true,
      contact,
      tags: updatedTags,
      message: 'Contact tags updated successfully'
    })
  } catch (error: any) {
    console.error('[API] Patch contact error:', error)
    return NextResponse.json({ error: error.message || 'Failed to update tags' }, { status: 500 })
  }
}

// DELETE: Delete contact
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Contact ID is required' },
        { status: 400 }
      )
    }

    const recordResult = await verifyRecordAccess(request, 'contacts', id)
    if (!recordResult.authorized) {
      return NextResponse.json({ error: recordResult.error }, { status: recordResult.status })
    }

    const supabase = getSupabaseClient()

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

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId, contacts } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return NextResponse.json({ error: 'No contacts provided for import' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()

    // 1. Fetch existing phone numbers in organization for deduplication
    const { data: existingRows } = await supabase
      .from('contacts')
      .select('phone_number')
      .eq('organization_id', organizationId)

    const existingPhoneSet = new Set<string>()
    if (existingRows) {
      existingRows.forEach((r: any) => {
        if (r.phone_number) {
          const norm = r.phone_number.replace(/[\s-()]/g, '')
          existingPhoneSet.add(norm)
          // Also add without leading '+'
          existingPhoneSet.add(norm.replace(/^\+/, ''))
        }
      })
    }

    const validNewContacts: any[] = []
    let skippedCount = 0

    const seenInBatch = new Set<string>()

    for (const c of contacts) {
      const rawPhone = String(c.phoneNumber || c.phone || '').trim()
      const normalizedPhone = rawPhone.replace(/[\s-()]/g, '')
      const phoneWithoutPlus = normalizedPhone.replace(/^\+/, '')

      if (!normalizedPhone || normalizedPhone.length < 5) {
        skippedCount++
        continue
      }

      if (existingPhoneSet.has(normalizedPhone) || existingPhoneSet.has(phoneWithoutPlus) || seenInBatch.has(normalizedPhone) || seenInBatch.has(phoneWithoutPlus)) {
        skippedCount++
        continue
      }

      seenInBatch.add(normalizedPhone)
      seenInBatch.add(phoneWithoutPlus)

      validNewContacts.push({
        organization_id: organizationId,
        first_name: c.firstName ? String(c.firstName).trim() : null,
        last_name: c.lastName ? String(c.lastName).trim() : null,
        phone_number: normalizedPhone.startsWith('+') ? normalizedPhone : `+${normalizedPhone}`,
        email: c.email ? String(c.email).trim().toLowerCase() : null,
        company: c.company ? String(c.company).trim() : null,
        tags: Array.isArray(c.tags) ? c.tags : []
      })
    }

    if (validNewContacts.length === 0) {
      return NextResponse.json({
        success: true,
        imported: 0,
        skipped: skippedCount,
        total: contacts.length,
        message: 'No new contacts to import (all records were skipped or already exist).'
      })
    }

    // 2. Batch insert contacts in chunks of 50
    let insertedContacts: any[] = []
    const BATCH_SIZE = 50
    for (let i = 0; i < validNewContacts.length; i += BATCH_SIZE) {
      const chunk = validNewContacts.slice(i, i + BATCH_SIZE)
      const { data: inserted, error: insertError } = await supabase
        .from('contacts')
        .insert(chunk)
        .select()

      if (insertError) {
        console.error('[API Contacts Import] Batch insert error:', insertError)
        throw insertError
      }

      if (inserted) {
        insertedContacts = insertedContacts.concat(inserted)
      }
    }

    // 3. Auto-create conversations for newly inserted contacts
    if (insertedContacts.length > 0) {
      const convsToInsert = insertedContacts.map((c) => ({
        organization_id: organizationId,
        contact_id: c.id,
        is_active: true,
        last_message_at: new Date().toISOString()
      }))

      for (let i = 0; i < convsToInsert.length; i += BATCH_SIZE) {
        const convChunk = convsToInsert.slice(i, i + BATCH_SIZE)
        const { error: convErr } = await supabase
          .from('conversations')
          .insert(convChunk)

        if (convErr) {
          console.warn('[API Contacts Import] Auto-create conversations warning:', convErr)
        }
      }
    }

    return NextResponse.json({
      success: true,
      imported: insertedContacts.length,
      skipped: skippedCount,
      total: contacts.length,
      message: `Successfully imported ${insertedContacts.length} contacts (${skippedCount} skipped/duplicates).`
    })
  } catch (error: any) {
    console.error('[API Contacts Import] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to import contacts' },
      { status: 500 }
    )
  }
}

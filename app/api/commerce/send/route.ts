import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { isUuid } from '@/lib/record-visibility'
import { toDialablePhone } from '@/lib/campaigns/audience'
import {
  buildSingleProductMessage,
  buildMultiProductMessage,
  buildCatalogMessage,
  buildWebsiteRedirectUrl,
} from '@/lib/commerce/commerce-messages'
import { sendWhatsAppMessage } from '@/lib/commerce/commerce-webhook-handler'
import { explainCommerceError } from '@/lib/commerce/meta-catalog'
import { cleanWhatsAppRecipient } from '@/lib/whatsapp-bsuid'

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

const text = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)

/**
 * POST /api/commerce/send
 * Send a customer something from the store:
 *   single_product    one catalog item, with "Add to cart"
 *   multi_product     up to 30 catalog items in one message
 *   catalog           a button that opens the whole catalog
 *   website_redirect  a button to a product page on the store's website
 * The recipient is a contact (`contactId`) or a phone number (`phone`).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const { organizationId, type } = body || {}
    const payload = body?.payload && typeof body.payload === 'object' ? body.payload : {}

    if (!organizationId || !type) {
      return NextResponse.json({ error: 'Missing organizationId or message type' }, { status: 400 })
    }
    if (!body.contactId && !body.phone) {
      return NextResponse.json({ error: 'Choose who to send this to.' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId, { permission: 'records.write' })
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabase()
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .select('id, meta_catalog_id, whatsapp_api_token, whatsapp_phone_number_id, whatsapp_graph_api_version')
      .eq('id', organizationId)
      .single()

    if (orgErr || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }
    if (!org.whatsapp_api_token || !org.whatsapp_phone_number_id) {
      return NextResponse.json({ error: 'WhatsApp is not connected. Connect it in Settings first.' }, { status: 400 })
    }

    // ── Who it goes to ──
    let contactId: string | null = null
    let phone = ''
    if (body.contactId) {
      if (!isUuid(body.contactId)) {
        return NextResponse.json({ error: 'Invalid contact' }, { status: 400 })
      }
      const { data: contact } = await supabase
        .from('contacts')
        .select('id, phone_number')
        .eq('id', body.contactId)
        .eq('organization_id', organizationId)
        .maybeSingle()
      if (!contact) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
      }
      contactId = contact.id
      phone = contact.phone_number || ''
    } else {
      const dialable = toDialablePhone(body.phone)
      if (!dialable) {
        return NextResponse.json({ error: 'Enter the full phone number with its country code, for example +91 98765 43210.' }, { status: 400 })
      }
      phone = dialable
      // If this number belongs to a contact, the message is logged in their chat
      const { data: known } = await supabase
        .from('contacts')
        .select('id')
        .eq('organization_id', organizationId)
        .in('phone_number', [dialable, dialable.slice(1)])
        .limit(1)
      contactId = known?.[0]?.id || null
    }
    if (!phone) {
      return NextResponse.json({ error: 'This contact has no phone number.' }, { status: 400 })
    }

    // The chat the send is logged in: the one named by the caller, otherwise the contact's latest
    let conversationId: string | null = null
    if (body.conversationId) {
      if (!isUuid(body.conversationId)) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
      }
      const { data: conversation } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', body.conversationId)
        .eq('organization_id', organizationId)
        .maybeSingle()
      if (!conversation) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
      }
      conversationId = conversation.id
    } else if (contactId) {
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('contact_id', contactId)
        .order('last_message_at', { ascending: false })
        .limit(1)
      conversationId = conversations?.[0]?.id || null
    }

    // ── What is sent ──
    const catalogId = org.meta_catalog_id
    const needsCatalog = type === 'single_product' || type === 'multi_product' || type === 'catalog'
    if (needsCatalog && !catalogId) {
      return NextResponse.json({ error: 'Link your Meta catalog in Commerce → Store settings to send products in WhatsApp.' }, { status: 400 })
    }

    let metaPayload: any
    let logSummary: string

    try {
      if (type === 'single_product') {
        const sku = text(payload.productRetailerId, 100)
        metaPayload = buildSingleProductMessage({
          phone,
          catalogId,
          productRetailerId: sku,
          bodyText: text(payload.bodyText, 1024),
          footerText: text(payload.footerText, 60) || undefined,
        })
        logSummary = `[Sent product: ${text(payload.productTitle, 80) || `SKU ${sku}`}]`
      } else if (type === 'multi_product') {
        const skus = [...new Set((Array.isArray(payload.productRetailerIds) ? payload.productRetailerIds : []).map((sku: unknown) => text(sku, 100)).filter(Boolean))] as string[]
        if (skus.length === 0) {
          return NextResponse.json({ error: 'Choose at least one product to send.' }, { status: 400 })
        }
        if (skus.length > 30) {
          return NextResponse.json({ error: 'WhatsApp shows at most 30 products in one message. Choose fewer.' }, { status: 400 })
        }
        metaPayload = buildMultiProductMessage({
          phone,
          catalogId,
          headerText: text(payload.headerText, 60) || 'Our picks for you',
          bodyText: text(payload.bodyText, 1024) || 'Tap a product to see it and add it to your cart.',
          footerText: text(payload.footerText, 60) || undefined,
          sections: [{ title: text(payload.sectionTitle, 24) || 'Products', productRetailerIds: skus }],
        })
        logSummary = `[Sent ${skus.length} product${skus.length === 1 ? '' : 's'} from the catalog]`
      } else if (type === 'catalog') {
        metaPayload = buildCatalogMessage({
          phone,
          bodyText: text(payload.bodyText, 1024) || undefined,
          thumbnailProductRetailerId: text(payload.thumbnailProductRetailerId, 100) || undefined,
        })
        logSummary = '[Sent the full catalog]'
      } else if (type === 'website_redirect') {
        // Never send a customer to a placeholder address
        let websiteUrl: URL | null = null
        try {
          websiteUrl = new URL(String(payload.websiteUrl || ''))
        } catch {
          websiteUrl = null
        }
        if (!websiteUrl || websiteUrl.protocol !== 'https:') {
          return NextResponse.json(
            { error: 'This product has no website link. Add an https:// product page URL to it first.' },
            { status: 400 }
          )
        }
        const title = text(payload.productTitle, 80)
        metaPayload = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanWhatsAppRecipient(phone),
          type: 'interactive',
          interactive: {
            type: 'cta_url',
            body: { text: text(payload.bodyText, 1024) || `View ${title || 'this item'} on our online store:` },
            action: {
              name: 'cta_url',
              parameters: {
                display_text: 'View on website',
                url: buildWebsiteRedirectUrl({
                  baseUrl: websiteUrl.toString(),
                  productRetailerId: text(payload.productRetailerId, 100) || undefined,
                  contactId: contactId || undefined,
                  campaignId: text(payload.campaignId, 60) || undefined,
                  couponCode: text(payload.couponCode, 40) || undefined,
                }),
              },
            },
          },
        }
        logSummary = `[Sent website link: ${title || 'product'}]`
      } else {
        return NextResponse.json({ error: 'Unsupported message type' }, { status: 400 })
      }
    } catch (buildErr: any) {
      return NextResponse.json({ error: buildErr.message }, { status: 400 })
    }

    // ── Send ──
    const result = await sendWhatsAppMessage(org, metaPayload)
    if (!result.ok) {
      return NextResponse.json({ error: explainCommerceError(result.error) }, { status: 422 })
    }

    const messageId = result.messageId ? `FB_${result.messageId}` : null
    if (conversationId) {
      await supabase.from('messages').insert({
        organization_id: organizationId,
        conversation_id: conversationId,
        sender_type: 'user',
        body: logSummary,
        twilio_message_sid: messageId,
        status: 'sent',
      })
      await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)
    }

    return NextResponse.json({ success: true, messageId, conversationId, phone })
  } catch (err: any) {
    console.error('[API Commerce Send POST] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

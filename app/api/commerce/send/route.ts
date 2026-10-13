import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import {
  buildSingleProductMessage,
  buildMultiProductMessage,
  buildCatalogMessage,
  buildOrderDetailsMessage,
  buildWebsiteRedirectUrl,
} from '@/lib/commerce/commerce-messages'
import { getPaymentGateway } from '@/lib/commerce/commerce-utils'

function getSupabase() {
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
    const {
      organizationId,
      conversationId,
      phone,
      type, // 'single_product' | 'multi_product' | 'catalog' | 'order_details' | 'website_redirect'
    } = body
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}

    if (!organizationId || !phone || !type) {
      return NextResponse.json(
        { error: 'Missing organizationId, phone, or message type' },
        { status: 400 }
      )
    }

    const authResult = await verifyOrgAccess(request, organizationId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabase()
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .single()

    if (orgErr || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    if (!org.whatsapp_api_token || !org.whatsapp_phone_number_id) {
      return NextResponse.json(
        { error: 'WhatsApp Cloud API credentials not configured in settings' },
        { status: 400 }
      )
    }

    // The send is logged into this conversation, so it has to be one of the caller's own
    if (conversationId) {
      const { data: conversation } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('organization_id', organizationId)
        .maybeSingle()

      if (!conversation) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
      }
    }

    const catalogId = org.meta_catalog_id || payload.catalogId

    let metaPayload: any = null
    let logSummary = ''

    if (type === 'single_product') {
      if (!catalogId) {
        return NextResponse.json(
          { error: 'Meta Catalog ID is required for Single Product Messages' },
          { status: 400 }
        )
      }
      metaPayload = buildSingleProductMessage({
        phone,
        catalogId,
        productRetailerId: payload.productRetailerId,
        bodyText: payload.bodyText,
        footerText: payload.footerText,
      })
      logSummary = `[Sent Product: SKU ${payload.productRetailerId}]`
    } else if (type === 'multi_product') {
      if (!catalogId) {
        return NextResponse.json(
          { error: 'Meta Catalog ID is required for Multi-Product Messages' },
          { status: 400 }
        )
      }
      metaPayload = buildMultiProductMessage({
        phone,
        catalogId,
        headerText: payload.headerText,
        bodyText: payload.bodyText,
        footerText: payload.footerText,
        sections: payload.sections,
      })
      logSummary = `[Sent Multi-Product Showcase]`
    } else if (type === 'catalog') {
      metaPayload = buildCatalogMessage({
        phone,
        bodyText: payload.bodyText,
        thumbnailProductRetailerId: payload.thumbnailProductRetailerId,
      })
      logSummary = `[Sent Full Catalog Message]`
    } else if (type === 'order_details') {
      const gateway = getPaymentGateway(org)
      if (!gateway) {
        return NextResponse.json(
          { error: 'Set up a payment gateway in Commerce → Store settings before requesting payment in the chat.' },
          { status: 400 }
        )
      }
      metaPayload = buildOrderDetailsMessage({
        phone,
        referenceId: payload.referenceId,
        currency: org.currency || 'INR',
        totalAmount: payload.totalAmount,
        subtotal: payload.subtotal,
        shippingFee: payload.shippingFee,
        taxAmount: payload.taxAmount,
        items: payload.items,
        paymentGatewayType: gateway.type,
        paymentGatewayConfigName: gateway.configName,
        bodyText: payload.bodyText,
      })
      logSummary = `[Sent WhatsApp Payment Request: ${org.currency || 'INR'} ${payload.totalAmount}]`
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
      const redirectUrl = buildWebsiteRedirectUrl({
        baseUrl: websiteUrl.toString(),
        productRetailerId: payload.productRetailerId,
        contactId: payload.contactId,
        campaignId: payload.campaignId,
        couponCode: payload.couponCode,
      })
      metaPayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone.replace('+', '').trim(),
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: {
            text: payload.bodyText || `View ${payload.productTitle || 'this item'} on our online store:`,
          },
          action: {
            name: 'cta_url',
            parameters: {
              display_text: 'View on Website',
              url: redirectUrl,
            },
          },
        },
      }
      logSummary = `[Sent Website Redirection Link: ${payload.productTitle || 'Product'}]`
    } else {
      return NextResponse.json({ error: 'Unsupported message type' }, { status: 400 })
    }

    // Send via Meta Cloud API
    const graphVersion = org.whatsapp_graph_api_version || 'v25.0'
    const sendRes = await fetch(
      `https://graph.facebook.com/${graphVersion}/${org.whatsapp_phone_number_id}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${org.whatsapp_api_token}`,
        },
        body: JSON.stringify(metaPayload),
      }
    )

    const sendData = await sendRes.json()
    if (!sendRes.ok || sendData.error) {
      console.error('[Commerce Send] Meta API error:', sendData)
      return NextResponse.json(
        { error: sendData?.error?.message || `Meta API HTTP ${sendRes.status}` },
        { status: sendRes.status }
      )
    }

    const messageId = sendData.messages?.[0]?.id ? `FB_${sendData.messages[0].id}` : `FB_${Date.now()}`

    // Log message into CRM conversation if conversationId is provided
    if (conversationId) {
      await supabase.from('messages').insert({
        organization_id: organizationId,
        conversation_id: conversationId,
        sender_type: 'user',
        body: logSummary,
        twilio_message_sid: messageId,
        status: 'sent',
      })
    }

    return NextResponse.json({ success: true, messageId })
  } catch (err: any) {
    console.error('[API Commerce Send POST] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

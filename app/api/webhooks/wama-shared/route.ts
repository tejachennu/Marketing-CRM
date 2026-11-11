import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { verifyMetaSignature } from '@/lib/meta-webhook'
import { handleSharedIncoming, handleSharedStatus, sharedConfig } from '@/lib/shared-whatsapp'

export const runtime = 'nodejs'

/**
 * Webhook for WAMA's own WhatsApp number (the one that sends booking messages for Starter workspaces).
 * In Meta, point that number's account at https://<app>/api/webhooks/wama-shared with the verify token
 * WAMA_SHARED_VERIFY_TOKEN, and subscribe to "messages". Signed with WAMA_SHARED_APP_SECRET when that
 * account belongs to another Meta app, else META_APP_SECRET.
 *
 * - Delivery statuses: a failed message is given back to the business's message wallet.
 * - A customer who writes: one automatic answer a day with the business's phone number.
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const token = String(process.env.WAMA_SHARED_VERIFY_TOKEN || '').trim()
  if (params.get('hub.mode') === 'subscribe' && token && params.get('hub.verify_token') === token) {
    return new NextResponse(params.get('hub.challenge') || '', { status: 200 })
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const secret = String(process.env.WAMA_SHARED_APP_SECRET || '').trim() || undefined
  const signature = verifyMetaSignature(raw, request.headers.get('x-hub-signature-256'), secret ? { secret } : {})
  if (!signature.valid) {
    console.warn('[WAMA shared webhook] Refused:', signature.note)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const config = sharedConfig()
  const db = getSupabaseAdminClient()
  try {
    for (const entry of body?.entry || []) {
      for (const change of entry?.changes || []) {
        const value = change?.value || {}
        // Only WAMA's own number
        if (config && value?.metadata?.phone_number_id && value.metadata.phone_number_id !== config.phoneNumberId) continue
        for (const status of value.statuses || []) await handleSharedStatus(db, status)
        for (const message of value.messages || []) {
          if (message?.from) await handleSharedIncoming(db, String(message.from))
        }
      }
    }
  } catch (error: any) {
    console.error('[WAMA shared webhook]', error?.message)
    // 200 anyway: Meta retrying would send the automatic answer twice
  }
  return NextResponse.json({ received: true })
}

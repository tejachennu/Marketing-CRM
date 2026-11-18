import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/api-auth-helper'
import { verifyMetaSignature } from '@/lib/meta-webhook'
import { sendPush } from '@/lib/push'
import { answerComment, answerDm } from '@/lib/instagram/automation'
import { readIgWebhook } from '@/lib/instagram/rules'
import { accountByIgId, saveComment, saveIncomingDm } from '@/lib/instagram/store'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Instagram webhooks for every connected workspace (Meta App Dashboard → Instagram → API setup with Unified
 * login → Configure webhooks: callback https://<app>/api/webhooks/instagram, verify token
 * INSTAGRAM_WEBHOOK_VERIFY_TOKEN; fields messages, messaging_postbacks, messaging_seen, comments).
 * Signed with the Meta app secret (META_APP_SECRET). The account id in each entry picks the workspace.
 */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const token = String(process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || '').trim()
  if (params.get('hub.mode') === 'subscribe' && token && params.get('hub.verify_token') === token) {
    return new NextResponse(params.get('hub.challenge') || '', { status: 200 })
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const signature = verifyMetaSignature(raw, request.headers.get('x-hub-signature-256'))
  if (!signature.valid) {
    console.warn('[Instagram webhook] Refused:', signature.note)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  let payload: any
  try { payload = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const db = getSupabaseAdminClient()
  const accounts = new Map<string, any>()
  for (const event of readIgWebhook(payload)) {
    try {
      let account = accounts.get(event.accountId)
      if (account === undefined) {
        account = await accountByIgId(db, event.accountId)
        accounts.set(event.accountId, account)
      }
      if (!account) continue
      if (event.kind === 'comment') {
        const saved = await saveComment(db, account, event)
        if (!saved) continue
        const done = await answerComment(db, account, saved)
        if (done !== 'answered' && done !== 'hidden') await sendPush(db, { organizationId: account.organization_id }, { kind: 'message', title: `@${event.fromUsername || 'Someone'} commented`, body: event.text.slice(0, 120) || 'New comment on Instagram', open: 'instagram', tag: `igc:${event.commentId}` }).catch(() => null)
        continue
      }
      if (event.kind !== 'message') continue
      const saved = await saveIncomingDm(db, account, event)
      if (!saved || event.echo) continue
      const { conversation, contact, message } = saved
      const who = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || `@${contact.instagram_username || 'instagram'}`
      await sendPush(db, { organizationId: account.organization_id, userIds: [conversation.assigned_to] }, { kind: 'message', title: `${who} (Instagram)`, body: message.body, open: `chat:${conversation.id}`, tag: `chat:${conversation.id}` }).catch(() => null)
      // AI reply from the knowledge base (Auto replies → AI answers DMs), unless a person has taken this chat
      await answerDm(db, account, { conversation, contact, text: event.text })
    } catch (error: any) {
      console.error('[Instagram webhook]', error?.message)
    }
  }
  // 200 always once signed: Meta retries for 36 hours otherwise, and every step above is safe to skip
  return NextResponse.json({ received: true })
}

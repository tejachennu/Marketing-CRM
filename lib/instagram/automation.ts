/**
 * Automatic answers on Instagram, used by the webhook (instant) and by the page's check of Instagram
 * (before webhooks work). Server only. Settings: Instagram → Auto replies (`instagram_accounts.automation`).
 *
 * - DMs: the AI answers from the knowledge base when "AI answers DMs" is on and the chat's AI is on; it hands
 *   the chat to a person when it cannot answer (AI off for that chat, pop-up).
 * - Comments: words to hide, keyword replies (public and/or one DM), AI public reply, or a reply to every
 *   other comment. Once per comment, only for comments under a day old.
 */

import { readHandoffSettings } from '../ai/knowledge-rules'
import { handOffToTeam, recordKnowledgeGap } from '../ai/knowledge-store'
import { instagramAiReply, instagramCommentAi } from './ai'
import { commentPlan } from './rules'
import { actOnComment, automationOf, sendDm, sendTyping } from './store'
import { instagramMessages, readReplyStyle } from '../ai/reply-format'

const DM_FRESH_MS = 2 * 3_600_000
const COMMENT_FRESH_MS = 86_400_000

async function orgOf(db: any, id: string) {
  const { data } = await db.from('organizations').select('*').eq('id', id).maybeSingle()
  return data || null
}

/** Answer a customer's DM with the AI when allowed. Returns what happened, for tests and logs. */
export async function answerDm(db: any, account: any, input: { conversation: any; contact: any; text: string; at?: number }, now: number = Date.now()): Promise<'sent' | 'handed_off' | 'skipped' | 'failed'> {
  const { conversation, contact, text } = input
  if (!text || !automationOf(account).dmAi || conversation.auto_reply_enabled === false) return 'skipped'
  if (input.at && now - input.at > DM_FRESH_MS) return 'skipped'
  const org = await orgOf(db, account.organization_id)
  if (!org) return 'skipped'
  // "typing…" while the AI writes (as the business set it)
  if (readReplyStyle(org.ai_handoff?.style).typing) await sendTyping(db, account.organization_id, conversation)
  const answer = await instagramAiReply(db, org, conversation.id, text)
  if (!answer) return 'skipped'
  let sent: { ok: boolean; mid?: string | null; error?: string } = { ok: true }
  if (answer.reply) {
    // Instagram's style: no formatting marks, ≤1,000 characters a message, quick-reply chips under the last one
    const parts = instagramMessages(answer.plan || { text: answer.reply })
    for (const part of parts as { text: string; quick_replies?: { title: string; payload: string }[] }[]) {
      sent = await sendDm(db, account.organization_id, conversation, { text: part.text, byPerson: false, quickReplies: part.quick_replies })
      await db.from('messages').insert({ organization_id: account.organization_id, conversation_id: conversation.id, sender_type: 'user', sender_id: null, body: part.text, twilio_message_sid: sent.ok && sent.mid ? `IG_${sent.mid}` : null, status: sent.ok ? 'sent' : 'failed', error_message: sent.ok ? null : sent.error })
      if (!sent.ok) break
    }
    // The photos, videos and files of the FAQs the answer used
    for (const file of sent.ok ? answer.attachments || [] : []) {
      const out = await sendDm(db, account.organization_id, conversation, { mediaUrl: file.url, byPerson: false })
      await db.from('messages').insert({ organization_id: account.organization_id, conversation_id: conversation.id, sender_type: 'user', sender_id: null, body: '[Media Attachment]', media_url: file.url, twilio_message_sid: out.ok && out.mid ? `IG_${out.mid}` : null, status: out.ok ? 'sent' : 'failed', error_message: out.ok ? null : out.error })
    }
  }
  if (answer.handOff) {
    // One ticket for the chat, AI paused (as the business set it), pop-up and ticket email
    const who = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || `@${contact?.instagram_username || 'instagram'}`
    const settings = readHandoffSettings(org?.ai_handoff)
    await handOffToTeam(db, { organizationId: account.organization_id, conversationId: conversation.id, contactId: contact?.id || conversation.contact_id, message: text, reason: answer.reason || 'not_answered', summary: answer.summary, urgent: answer.urgent, channel: 'instagram', settings, contactName: who, contactPhone: null })
    if (answer.reason === 'not_answered') await recordKnowledgeGap(db, account.organization_id, text, conversation.id)
    return 'handed_off'
  }
  return sent.ok ? 'sent' : 'failed'
}

/** Answer (or hide) a new comment by the business's rules. Once per comment. */
export async function answerComment(db: any, account: any, row: any, now: number = Date.now(), ai: typeof instagramCommentAi = instagramCommentAi): Promise<'hidden' | 'answered' | 'skipped' | 'failed'> {
  if (!row || row.replied_at || row.private_reply_at || row.hidden || row.deleted_at) return 'skipped'
  if (now - (Date.parse(row.created_at) || 0) > COMMENT_FRESH_MS) return 'skipped'
  const plan = commentPlan(automationOf(account), { text: row.text || '', fromUsername: row.from_username })
  if (!plan) return 'skipped'
  const org = account.organization_id
  if ('hide' in plan) {
    const done = await actOnComment(db, org, row.comment_id, { type: 'hide' })
    return 'ok' in done ? 'hidden' : 'failed'
  }
  let did = false
  let failed = false
  if (plan.dm) {
    const done = await actOnComment(db, org, row.comment_id, { type: 'private', text: plan.dm })
    if ('ok' in done) did = true
    else failed = true
  }
  let reply = plan.reply
  if (!reply && plan.ai) {
    const organization = await orgOf(db, org)
    reply = (organization && (await ai(db, organization, row.text || '', row.from_username || ''))) || ''
  }
  if (reply) {
    const done = await actOnComment(db, org, row.comment_id, { type: 'reply', text: reply })
    if ('ok' in done) did = true
    else failed = true
  }
  if (did) await db.from('instagram_comments').update({ auto_replied: true }).eq('organization_id', org).eq('comment_id', row.comment_id)
  return did ? 'answered' : failed ? 'failed' : 'skipped'
}

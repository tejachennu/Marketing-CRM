/**
 * The server side of voice at the counter: transcribe the audio, understand it against the salon's
 * own services, staff and today's appointments, and return a draft to confirm. Both AI calls go
 * through aiFetch, so they are charged to the workspace's AI credit.
 */

import { aiFetch, type AiAccess } from '../ai-access'
import { istDayRange, istDate, normalizeName } from './spoken'
import { resolveCommand, transcriptionPrompt, understandCommand, yesOrNo, type VoiceContext, type VoiceDraft } from './voice'

/** OpenAI's API. Only a development server may point it elsewhere (a local stand-in for tests). */
export function openAiBase(): string {
  const override = process.env.NODE_ENV !== 'production' ? String(process.env.OPENAI_API_BASE || '').trim().replace(/\/+$/, '') : ''
  return override || 'https://api.openai.com/v1'
}

export const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe'
/** About 25 seconds of compressed speech is far below this; anything bigger is not a counter command. */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024

export async function transcribe(db: any, access: AiAccess, audio: Blob, prompt: string, fetcher: typeof fetch = fetch): Promise<string> {
  const type = audio.type || 'audio/webm'
  const extension = type.includes('mp4') || type.includes('m4a') || type.includes('aac') ? 'mp4' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm'
  const form = new FormData()
  form.append('file', audio, `counter.${extension}`)
  form.append('model', TRANSCRIBE_MODEL)
  form.append('prompt', prompt)
  form.append('response_format', 'json')
  const response = await aiFetch(db, access, 'salon_voice', `${openAiBase()}/audio/transcriptions`, { method: 'POST', body: form }, fetcher)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error?.message ? `Speech could not be read: ${data.error.message}` : 'Speech could not be read. Please try again.')
  return String(data?.text || '').trim()
}

/** Everything the understanding step needs about the salon, loaded in parallel. */
export async function loadVoiceContext(db: any, organizationId: string, settings: VoiceContext['settings'], now = Date.now()): Promise<VoiceContext> {
  const { start, end } = istDayRange(istDate(now))
  const [services, staff, appointments, paid] = await Promise.all([
    db.from('salon_services').select('id, name, category, price, duration_minutes, tax_rate, active').eq('organization_id', organizationId).order('position'),
    db.from('salon_staff').select('id, name, active').eq('organization_id', organizationId).order('name'),
    db.from('salon_appointments').select('*').eq('organization_id', organizationId).gte('starts_at', start).lt('starts_at', end).order('starts_at'),
    db.from('salon_invoices').select('total').eq('organization_id', organizationId).eq('status', 'paid').gte('paid_at', start).lt('paid_at', end),
  ])
  for (const result of [services, staff, appointments]) if (result.error) throw new Error(result.error.message)
  return {
    now,
    services: services.data || [],
    staff: staff.data || [],
    appointments: (appointments.data || []).map((a: any) => ({ ...a, services: Array.isArray(a.services) ? a.services : [] })),
    collectedToday: (paid.data || []).reduce((sum: number, row: any) => sum + (Number(row.total) || 0), 0),
    settings,
  }
}

/** Contacts whose first name starts like the spoken one, for "book Priya" without a number. */
export async function findContacts(db: any, organizationId: string, spokenName: string | null): Promise<VoiceContext['contacts']> {
  const first = normalizeName(spokenName).split(' ')[0]
  if (!first || first.length < 2) return []
  const { data } = await db.from('contacts').select('id, first_name, last_name, phone_number').eq('organization_id', organizationId).ilike('first_name', `${first.slice(0, 3)}%`).limit(25)
  return (data || []).map((c: any) => ({ id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(' ').trim(), phone: c.phone_number || null })).filter((c: any) => c.name)
}

export type VoiceResult =
  | { kind: 'confirm' | 'reject'; transcript: string }
  | { kind: 'draft'; transcript: string; draft: VoiceDraft }
  | { kind: 'empty'; transcript: '' }

/**
 * From words to a result. With a draft waiting, a short "yes"/"no" answers it; anything else is a
 * new command. `post` sends a chat completions request (already charged) and returns its body.
 */
export async function interpret(transcript: string, pending: boolean, context: VoiceContext, post: (body: unknown) => Promise<any>, contacts: (name: string | null) => Promise<VoiceContext['contacts']>): Promise<VoiceResult> {
  const words = transcript.trim()
  if (!words) return { kind: 'empty', transcript: '' }
  if (pending) {
    const answer = yesOrNo(words)
    if (answer) return { kind: answer === 'yes' ? 'confirm' : 'reject', transcript: words }
  }
  const parsed = await understandCommand(words, context, post)
  const needsContacts = (parsed.intent === 'book' || parsed.intent === 'walk_in') && parsed.customer_name && !parsed.customer_phone
  const withContacts = needsContacts ? { ...context, contacts: await contacts(parsed.customer_name) } : context
  return { kind: 'draft', transcript: words, draft: resolveCommand(parsed, words, withContacts) }
}

export { transcriptionPrompt }

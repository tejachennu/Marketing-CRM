import { after, NextRequest, NextResponse } from 'next/server'
import { aiFetch, getAiAccess } from '@/lib/ai-access'
import { badRequest, loadSalonSettings, salonAccess } from '@/lib/salon/server'
import { findContacts, interpret, loadVoiceContext, MAX_AUDIO_BYTES, openAiBase, transcribe, transcriptionPrompt } from '@/lib/salon/voice-server'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST: what the receptionist said, as a draft to confirm (nothing is changed here).
 * - multipart: audio (a short recording), organizationId, pending ("1" while a draft is on screen)
 * - JSON: { organizationId, transcript, pending } for a typed command
 * Returns { kind: 'draft', transcript, draft } or { kind: 'confirm' | 'reject' } or { kind: 'empty' }.
 */
export async function POST(request: NextRequest) {
  const multipart = (request.headers.get('content-type') || '').includes('multipart/form-data')
  let organizationId = ''
  let pending = false
  let audio: Blob | null = null
  let typed = ''
  if (multipart) {
    const form = await request.formData().catch(() => null)
    if (!form) return badRequest('The recording did not arrive. Please try again.')
    organizationId = String(form.get('organizationId') || '')
    pending = form.get('pending') === '1'
    const file = form.get('audio')
    if (file && typeof file !== 'string') audio = file
  } else {
    const body = await request.json().catch(() => ({}))
    organizationId = String(body?.organizationId || '')
    pending = Boolean(body?.pending)
    typed = String(body?.transcript || '').slice(0, 500)
  }

  const access = await salonAccess(request, organizationId, 'records.write')
  if (!access.ok) return access.response
  const { db, user, organization } = access.ctx

  if (multipart && (!audio || audio.size === 0)) return badRequest('Nothing was recorded. Tap the mic and speak.')
  if (audio && audio.size > MAX_AUDIO_BYTES) return badRequest('That recording is too long. Keep it to one short sentence.')
  if (!multipart && !typed.trim()) return badRequest('Say or type what to do.')

  const ai = await getAiAccess(db, organizationId, organization as any)
  if (!ai.allowed) return NextResponse.json({ error: `${ai.reason} Voice is paused until then; the counter buttons still work.`, aiPaused: true }, { status: 402 })

  try {
    const settings = await loadSalonSettings(db, organizationId)
    const context = await loadVoiceContext(db, organizationId, { gstin: settings.gstin, prices_include_tax: settings.prices_include_tax })
    const transcript = audio ? await transcribe(db, ai, audio, transcriptionPrompt(context)) : typed.trim()
    const post = async (body: unknown) => {
      const response = await aiFetch(db, ai, 'salon_voice', `${openAiBase()}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error?.message ? `The command could not be understood: ${data.error.message}` : 'The command could not be understood. Please try again.')
      return data
    }
    const result = await interpret(transcript, pending, context, post, (name) => findContacts(db, organizationId, name))

    if (result.kind === 'draft') {
      // Best effort: a record of what was heard and understood, to improve the wording over time
      const { draft } = result
      after(async () => {
        const { error } = await db.from('salon_voice_log').insert({
          organization_id: organizationId, user_id: user?.id || null, transcript: result.transcript,
          action: { intent: draft.intent, language: draft.language, missing: draft.missing, service_ids: draft.service_ids, unknown_services: draft.unknown_services, appointment_id: draft.appointment_id },
        })
        if (error) console.error('[Salon voice] Log failed:', error.message)
      })
      // Today's appointments, so the card can show (and bill) the one it means whichever day the board shows
      return NextResponse.json({ success: true, ...result, appointments: context.appointments })
    }
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    console.error('[Salon voice]', error?.message || error)
    return NextResponse.json({ error: error?.message || 'That could not be understood. Please try again.' }, { status: 502 })
  }
}

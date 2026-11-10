/**
 * The tick-box services form for the WhatsApp booking flow: one WhatsApp form (a Meta "Flow")
 * that shows every service under its category, so the customer ticks several and taps Continue.
 *
 * The form's layout is the same for every business: up to 10 groups of tick boxes, each with a
 * heading. The services themselves go in the message that opens the form (`flow_action_payload`),
 * so a change to services never needs the form published again. It is published once per
 * WhatsApp account (`salon_settings.services_form`) and published again only when FORM_VERSION
 * changes. When it cannot be used (not published, too many services, Twilio), the flow sends the
 * usual list instead.
 */

import { groupByCategory } from './categories'
import { formatRupees } from './invoice'
import { withSalonSchema } from './schema'
import { getMetaCredentials, metaRequest, uploadNativeFlow, type MetaCredentials } from '../flows/meta-client'

export const FORM_VERSION = 1
export const FORM_SCREEN = 'SERVICES'
/** Groups of tick boxes in the form, and tick boxes in a group (WhatsApp allows 20 per group). */
export const FORM_GROUPS = 10
export const GROUP_SIZE = 20
/** How long to wait before trying to publish again after Meta refused. */
const RETRY_MS = 60 * 60 * 1000

type Service = { id: string; name: string; category?: string | null; price: number | string; duration_minutes: number }
type Item = { id: string; title: string; description: string }

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)
const groupKeys = Array.from({ length: FORM_GROUPS }, (_, i) => `g${i}`)

/** The form's layout, in Meta's form language (Flow JSON). The same for every business. */
export function servicesFormJson() {
  const item = { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } } }
  const data: Record<string, unknown> = {
    intro: { type: 'string', __example__: 'Tick everything you would like, then tap Continue.' },
    button: { type: 'string', __example__: 'Continue' },
  }
  const boxes: Record<string, unknown>[] = []
  for (const key of groupKeys) {
    data[`${key}_label`] = { type: 'string', __example__: 'Hair' }
    data[`${key}_items`] = { type: 'array', items: item, __example__: [{ id: 'a', title: 'Haircut', description: '₹600 · 45 min' }] }
    data[`${key}_show`] = { type: 'boolean', __example__: true }
    boxes.push({ type: 'CheckboxGroup', name: key, label: `\${data.${key}_label}`, 'data-source': `\${data.${key}_items}`, visible: `\${data.${key}_show}`, required: false })
  }
  return {
    version: '7.3',
    screens: [{
      id: FORM_SCREEN,
      title: 'Choose services',
      terminal: true,
      success: true,
      data,
      layout: {
        type: 'SingleColumnLayout',
        children: [{
          type: 'Form',
          name: 'form',
          children: [
            { type: 'TextBody', text: '${data.intro}' },
            ...boxes,
            { type: 'Footer', label: '${data.button}', 'on-click-action': { name: 'complete', payload: Object.fromEntries(groupKeys.map((key) => [key, `\${form.${key}}`])) } },
          ],
        }],
      },
    }],
  }
}

/**
 * What the form shows for this business: its services, by category in the business's order
 * (a category with more than 20 is split: "Hair", "Hair (2)"). Null when they do not fit
 * (more than 10 groups), so the flow sends the list instead.
 */
export function servicesFormData(services: Service[], categoryOrder: unknown, words: { intro: string; button: string }): Record<string, unknown> | null {
  const groups: { label: string; items: Item[] }[] = []
  for (const [category, list] of groupByCategory<Service>(categoryOrder as string[] | undefined, services)) {
    for (let start = 0, part = 1; start < list.length; start += GROUP_SIZE, part++) {
      const label = part === 1 ? category : `${category} (${part})`
      groups.push({
        label: clip(label, 30),
        items: list.slice(start, start + GROUP_SIZE).map((s: Service) => ({ id: s.id, title: clip(s.name, 30), description: `${formatRupees(Number(s.price) || 0)} · ${s.duration_minutes} min` })),
      })
    }
  }
  if (!groups.length || groups.length > FORM_GROUPS) return null
  const data: Record<string, unknown> = { intro: clip(words.intro, 4000), button: clip(words.button, 35) }
  groupKeys.forEach((key, i) => {
    const group = groups[i]
    data[`${key}_label`] = group?.label || '-'
    // A hidden group still needs one row to be a valid list
    data[`${key}_items`] = group?.items || [{ id: 'none', title: '-', description: '' }]
    data[`${key}_show`] = Boolean(group)
  })
  return data
}

/** The services the customer ticked, in the form's order, known services only, no repeats. */
export function tickedServices(response: Record<string, unknown> | null | undefined, services: { id: string }[]): string[] {
  const known = new Set(services.map((s) => s.id))
  const out: string[] = []
  for (const key of groupKeys) {
    const value = response?.[key]
    for (const id of Array.isArray(value) ? value : []) {
      const text = String(id)
      if (known.has(text) && !out.includes(text)) out.push(text)
    }
  }
  return out
}

/** The token that brings the customer's ticks back to their booking in progress. */
export const formToken = (sessionId: string) => `bk:${sessionId}`
export function sessionFromToken(token: unknown): string | null {
  const m = /^bk:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(String(token ?? ''))
  return m ? m[1].toLowerCase() : null
}

/** The WhatsApp message that opens the form. */
export function buildFormMessage(phone: string, input: { formId: string; sessionId: string; body: string; button: string; data: Record<string, unknown> }) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone.replace(/[^\d]/g, ''),
    type: 'interactive',
    interactive: {
      type: 'flow',
      body: { text: clip(input.body, 1024) },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          mode: 'published',
          flow_id: input.formId,
          flow_token: formToken(input.sessionId),
          flow_cta: clip(input.button, 20),
          flow_action: 'navigate',
          flow_action_payload: { screen: FORM_SCREEN, data: input.data },
        },
      },
    },
  }
}

export interface FormState { id?: string; version?: number; ready?: boolean; error?: string; tried_at?: string }

/**
 * The business's published form (its Meta id), publishing it first when needed. Returns the id,
 * or the reason it cannot be used. `force` tries again even soon after a failure (on Save).
 */
export async function ensureServicesForm(db: any, organization: any, options: { force?: boolean; now?: number; fetcher?: typeof fetch } = {}): Promise<{ id: string } | { problem: string }> {
  const now = options.now ?? Date.now()
  let credentials: MetaCredentials
  try {
    credentials = getMetaCredentials(organization)
  } catch {
    return { problem: 'The tick-box form needs WhatsApp connected through Meta (Cloud API). Customers get the list instead.' }
  }
  const { data: row } = await withSalonSchema(() => db.from('salon_settings').select('services_form').eq('organization_id', organization.id).maybeSingle())
  const state: FormState = (row?.services_form && typeof row.services_form === 'object' ? row.services_form : {}) as FormState
  if (state.ready && state.id && state.version === FORM_VERSION) return { id: state.id }
  if (!options.force && state.error && state.tried_at && now - Date.parse(state.tried_at) < RETRY_MS) return { problem: state.error }

  const save = async (patch: FormState) => {
    Object.assign(state, patch)
    await withSalonSchema(() => db.from('salon_settings').update({ services_form: state }).eq('organization_id', organization.id))
  }
  // A draft from an earlier try of this version is reused; an older version gets a new form
  const draft = state.version === FORM_VERSION && !state.ready ? state.id : undefined
  try {
    const stamp = new Date(now).toISOString().slice(0, 16).replace('T', ' ')
    const id = await uploadNativeFlow(
      credentials,
      { name: `Front Desk services v${FORM_VERSION} ${stamp}`, categories: ['APPOINTMENT_BOOKING'], flow_id_meta: draft },
      servicesFormJson() as any,
      async (newId) => save({ id: newId, version: FORM_VERSION, ready: false }),
      options.fetcher,
    )
    await metaRequest(credentials, `${id}/publish`, { method: 'POST' }, options.fetcher)
    await save({ id, version: FORM_VERSION, ready: true, error: undefined, tried_at: new Date(now).toISOString() })
    return { id }
  } catch (error: any) {
    const reason = `WhatsApp did not accept the tick-box form: ${String(error?.message || error).slice(0, 200)}. Customers get the list instead.`
    await save({ version: FORM_VERSION, ready: false, error: reason, tried_at: new Date(now).toISOString(), ...(draft ? { id: draft } : {}) }).catch(() => {})
    return { problem: reason }
  }
}

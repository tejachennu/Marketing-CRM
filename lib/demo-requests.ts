/**
 * "Book a demo" requests from the public website. Each one becomes a contact and a lead in the
 * workspace that sells WAMA CRM, so the team can follow it up like any other lead.
 */

import { MAGNETORA_ORG_ID } from '@/lib/flows/flow-types'

export interface DemoRequest {
  name: string
  email: string
  /** E.164, the way WhatsApp contacts are stored: +919876543210 */
  phone: string
  goal: string
  /** Where the visitor came from: UTM tags, ad click IDs and the page they were on */
  source: Record<string, string>
}

const TRACKING_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'page']

/** The workspace that receives demo requests. */
export function demoRequestsOrgId(): string {
  return String(process.env.DEMO_REQUESTS_ORG_ID || '').trim() || MAGNETORA_ORG_ID
}

/** A phone number as WhatsApp stores it. A bare 10-digit Indian mobile number gets +91. */
export function normalizeDemoPhone(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^00/, '')
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`
  return /^[1-9]\d{9,14}$/.test(digits) ? `+${digits}` : null
}

/** The request, or the reason it cannot be accepted. `spam` is true for the hidden honeypot field. */
export function parseDemoRequest(body: any): { request: DemoRequest } | { error: string; spam?: boolean } {
  if (!body || typeof body !== 'object') return { error: 'Fill in the form and try again.' }
  // A field people never see: anything in it was typed by a bot
  if (String(body.website || '').trim()) return { error: 'Request not accepted.', spam: true }
  const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 120)
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200)
  const phone = normalizeDemoPhone(body.phone)
  const goal = String(body.goal || body.objective || '').trim().slice(0, 120) || 'Not specified'
  if (name.length < 2) return { error: 'Enter your name.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'Enter a valid email address.' }
  if (!phone) return { error: 'Enter a valid WhatsApp number, e.g. 98765 43210.' }
  const source: Record<string, string> = {}
  for (const key of TRACKING_KEYS) {
    const value = String(body.source?.[key] ?? '').trim()
    if (value) source[key] = value.slice(0, 200)
  }
  return { request: { name, email, phone, goal, source } }
}

/** The lead's notes: what was asked for, and where the visitor came from. */
export function demoLeadNotes(request: DemoRequest): string {
  const lines = [`Demo requested from the website`, `Goal: ${request.goal}`, `Email: ${request.email}`, `WhatsApp: ${request.phone}`]
  const tracking = Object.entries(request.source)
  if (tracking.length) lines.push('', 'Source:', ...tracking.map(([key, value]) => `${key}: ${value}`))
  return lines.join('\n')
}

/**
 * Save the request as a contact (found by phone, or created) and a new lead in the first pipeline
 * stage. Returns the lead's id.
 */
export async function saveDemoRequest(database: any, organizationId: string, request: DemoRequest): Promise<string> {
  const checked = async (query: any) => {
    const result = await query
    if (result.error) throw new Error(result.error.message)
    return result.data
  }
  const [firstName, ...rest] = request.name.split(' ')
  let contact = await checked(database.from('contacts').select('id, email, tags').eq('organization_id', organizationId).eq('phone_number', request.phone).limit(1).maybeSingle())
  const tags = (existing: unknown) => [...new Set([...(Array.isArray(existing) ? existing : []), 'Website demo'])]
  if (contact) {
    await checked(database.from('contacts').update({ ...(contact.email ? {} : { email: request.email }), tags: tags(contact.tags) }).eq('id', contact.id).eq('organization_id', organizationId))
  } else {
    contact = await checked(database.from('contacts').insert({
      organization_id: organizationId, first_name: firstName, last_name: rest.join(' ') || null, email: request.email,
      phone_number: request.phone, whatsapp_number: `whatsapp:${request.phone}`, tags: tags([]),
    }).select('id').single())
  }
  const stages: any[] = await checked(database.from('pipeline_stages').select('id').eq('organization_id', organizationId).order('position').limit(1))
  const campaign = request.source.utm_campaign || request.source.utm_source
  const lead = await checked(database.from('leads').insert({
    organization_id: organizationId, contact_id: contact.id,
    title: `Demo: ${request.name}${campaign ? ` (${campaign})` : ''}`,
    value: 0, status: 'active', source: request.source.gclid ? 'Google Ads' : request.source.fbclid ? 'Meta Ads' : 'Website demo form',
    pipeline_stage_id: stages[0]?.id || null, notes: demoLeadNotes(request),
  }).select('id').single())
  return lead.id
}

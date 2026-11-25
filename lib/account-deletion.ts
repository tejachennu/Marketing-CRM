/**
 * "Delete my account" (Google Play asks every app that makes accounts to let people ask for deletion inside the app
 * and on the web). A request is emailed to the team, who check it and delete the data; the person gets a copy.
 * The owner asks for the whole workspace to go; anyone else (admins too) asks for their own login only.
 * Pure: builds the two emails. The route (app/api/auth/delete-account) sends them.
 */
import { escapeHtml } from './utils'

export const DELETION_SUPPORT_EMAIL = 'support@magnetora.ai'
export const MAX_REASON = 500

export interface DeletionRequest {
  userId: string
  email: string
  name?: string | null
  role?: string | null
  organizationId?: string | null
  organizationName?: string | null
  /** the owner: the workspace and all its data; otherwise only this person's login */
  wholeWorkspace: boolean
  reason?: string | null
  at: Date
}

/** The reason as typed, trimmed and cut to a sane length (empty → null). */
export function cleanReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON)
  return text || null
}

/** What will be deleted, in plain words (shown in the app and in the emails). */
export function deletionScope(wholeWorkspace: boolean): string {
  return wholeWorkspace
    ? 'your login and your whole workspace: customers, chats, bookings, bills, orders, products and settings, for everyone on your team'
    : 'your login. Your workspace and its data stay for the rest of your team'
}

/** Who the team email goes to: the platform's super admins, else the support mailbox. */
export function teamRecipients(superAdmins: string[]): string[] {
  const list = superAdmins.map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@'))
  return list.length ? Array.from(new Set(list)) : [DELETION_SUPPORT_EMAIL]
}

export function deletionEmails(req: DeletionRequest) {
  const when = req.at.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
  const scope = deletionScope(req.wholeWorkspace)
  const rows: [string, string][] = [
    ['Email', req.email],
    ['Name', req.name || '-'],
    ['Role', req.role || '-'],
    ['Workspace', req.organizationName ? `${req.organizationName} (${req.organizationId || '-'})` : req.organizationId || '-'],
    ['User id', req.userId],
    ['Delete', req.wholeWorkspace ? 'Whole workspace and login' : 'This login only'],
    ['Reason', req.reason || '-'],
    ['Asked at', `${when} IST`],
  ]
  const table = rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6B7894">${escapeHtml(k)}</td><td style="padding:4px 0;color:#0E1B3D"><strong>${escapeHtml(v)}</strong></td></tr>`).join('')
  const team = {
    subject: `Account deletion request: ${req.email}${req.organizationName ? ` (${req.organizationName})` : ''}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0E1B3D"><p>Someone asked to delete their account from the app.</p><table>${table}</table><p>Check it is really them (reply to ${escapeHtml(req.email)}), cancel any plan, then delete: ${escapeHtml(scope)}.</p></div>`,
    text: `Account deletion request\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nCheck it is really them, cancel any plan, then delete: ${scope}.`,
  }
  const person = {
    subject: 'We got your request to delete your account',
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0E1B3D;line-height:1.5"><p>Hi${req.name ? ` ${escapeHtml(req.name)}` : ''},</p><p>We got your request to delete ${escapeHtml(scope)}.</p><p>Our team will check the request came from you, then delete it and email you when it is done. Some records, like bills and payments, may be kept for as long as the law requires.</p><p>Did not ask for this, or changed your mind? Reply to this email or write to ${DELETION_SUPPORT_EMAIL}.</p></div>`,
    text: `Hi${req.name ? ` ${req.name}` : ''},\n\nWe got your request to delete ${scope}.\n\nOur team will check the request came from you, then delete it and email you when it is done. Some records, like bills and payments, may be kept for as long as the law requires.\n\nDid not ask for this, or changed your mind? Reply to this email or write to ${DELETION_SUPPORT_EMAIL}.`,
  }
  return { team, person }
}

/**
 * Which dashboard modules a workspace gets. Every client workspace has all of them. Consular
 * Helpdesk (WhatsApp through Twilio) keeps the setup it has always had: no Flow Builder, Commerce,
 * Team page or Billing. Its admins manage their people from Settings → Teammates, as before.
 */

export const CONSULAR_HIDDEN_PAGES = ['/dashboard/flows', '/dashboard/commerce', '/dashboard/team', '/dashboard/billing'] as const

function hasValue(value: unknown): boolean {
  return String(value ?? '').trim().length > 0
}

/**
 * Consular Helpdesk: by name, or as a workspace that sends WhatsApp through Twilio (the same rule
 * that keeps it out of billing). Accepts a full organization row or the member-safe one from
 * /api/organization, which reports `twilio_connected` in place of the Twilio credentials.
 */
export function isConsularHelpdesk(organization: Record<string, any> | null | undefined): boolean {
  if (!organization) return false
  if (/consular/i.test(`${organization.name || ''} ${organization.slug || ''}`)) return true
  const twilioConnected = organization.twilio_connected === true || (hasValue(organization.twilio_account_sid) && hasValue(organization.twilio_auth_token))
  return (organization.whatsapp_provider || 'twilio') === 'twilio' && twilioConnected
}

/** Whether a workspace has the module behind a dashboard page. */
export function workspaceHasPage(organization: Record<string, any> | null | undefined, pathname: string): boolean {
  if (!isConsularHelpdesk(organization)) return true
  return !CONSULAR_HIDDEN_PAGES.some((base) => pathname === base || pathname.startsWith(`${base}/`))
}

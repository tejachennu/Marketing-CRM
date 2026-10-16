/**
 * Mail providers whose outgoing (SMTP) server the admin panel fills in. The server and port stay
 * editable, and "Send test email" shows whether the mailbox accepts them.
 */
export interface SmtpPreset {
  id: string
  label: string
  host: string
  port: number
  /** true: SSL/TLS from the first byte (port 465). false: STARTTLS after connecting (port 587). */
  secure: boolean
  hint?: string
}

export const SMTP_PRESETS: SmtpPreset[] = [
  {
    id: 'godaddy',
    label: 'GoDaddy Professional Email (Titan)',
    // GoDaddy's help page "Set up third-party plugins or websites using SMTP settings"
    host: 'smtpout.secureserver.net',
    port: 465,
    secure: true,
    hint: 'Sign in with the full email address and its mailbox password. If GoDaddy refuses it, try the server smtp.titan.email.',
  },
  { id: 'hostinger', label: 'Hostinger', host: 'smtp.hostinger.com', port: 465, secure: true },
  {
    id: 'google',
    label: 'Gmail / Google Workspace',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    hint: 'Google needs an app password (Google Account > Security > App passwords), not the normal password.',
  },
  { id: 'zoho-in', label: 'Zoho Mail (India)', host: 'smtp.zoho.in', port: 465, secure: true },
  { id: 'zoho', label: 'Zoho Mail', host: 'smtp.zoho.com', port: 465, secure: true },
  {
    id: 'microsoft',
    label: 'Microsoft 365 / Outlook',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    hint: 'Microsoft 365 must allow SMTP sign-in (SMTP AUTH) for this mailbox.',
  },
]

/** The preset for this server, if it is one of them. */
export function presetForHost(host: string | null | undefined): SmtpPreset | null {
  const normalized = String(host || '').trim().toLowerCase()
  return SMTP_PRESETS.find((preset) => preset.host === normalized) || null
}

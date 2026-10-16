/**
 * Where the platform's own emails (login codes, teammate invites) are sent from: the mailbox saved
 * in the superadmin panel, otherwise the one in the server's environment variables.
 * Server only: the settings include the mailbox password.
 */

import { getSupabaseAdminClient } from '@/lib/api-auth-helper'

export interface PlatformEmailSettings {
  host: string
  port: number
  /** true: SSL/TLS from the start (port 465). false: STARTTLS (port 587). */
  secure: boolean
  user: string
  password: string
  fromName: string
}

export type PlatformEmailSource = 'admin_panel' | 'environment' | 'none'

/** The sender name the platform's emails had before it could be set. */
export const DEFAULT_FROM_NAME = 'OmniCRM Security'

export const PLATFORM_EMAIL_TABLE = 'platform_email_settings'
export const PLATFORM_EMAIL_MIGRATION = 'supabase/migrations/20261016_platform_email_settings.sql'

type Env = Record<string, string | undefined>

/**
 * The mailbox in the environment: PLATFORM_SMTP_* when any of those is set, otherwise the older
 * HOSTINGER_SMTP_* names. The two sets are never mixed, so one mailbox's password is not sent
 * with another's address.
 */
export function settingsFromEnvironment(env: Env = process.env): PlatformEmailSettings | null {
  const prefix = Object.keys(env).some((name) => name.startsWith('PLATFORM_SMTP_') && env[name]) ? 'PLATFORM_SMTP_' : 'HOSTINGER_SMTP_'
  const read = (name: string) => String(env[prefix + name] || '').trim()
  const user = read('USER')
  const password = read('PASS')
  if (!user || !password) return null

  const port = Number.parseInt(read('PORT') || '465', 10)
  const secure = read('SECURE')
  return {
    host: read('HOST') || 'smtp.hostinger.com',
    port,
    secure: secure ? secure === 'true' : port === 465,
    user,
    password,
    fromName: cleanFromName(env.PLATFORM_EMAIL_FROM_NAME) || DEFAULT_FROM_NAME,
  }
}

/** Whether a database error means the settings table has not been created yet. */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message || '')
}

export interface SavedPlatformEmail {
  settings: PlatformEmailSettings | null
  /** False until the migration has created the table. */
  tableReady: boolean
}

/** The mailbox saved in the superadmin panel, if any. */
export async function loadSavedSettings(db: any = getSupabaseAdminClient()): Promise<SavedPlatformEmail> {
  const { data, error } = await db
    .from(PLATFORM_EMAIL_TABLE)
    .select('smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, from_name')
    .eq('id', 1)
    .maybeSingle()
  if (error) return { settings: null, tableReady: !isMissingTable(error) }
  if (!data?.smtp_host || !data?.smtp_user || !data?.smtp_password) return { settings: null, tableReady: true }
  return {
    tableReady: true,
    settings: {
      host: data.smtp_host,
      port: Number(data.smtp_port),
      secure: data.smtp_secure !== false,
      user: data.smtp_user,
      password: data.smtp_password,
      fromName: cleanFromName(data.from_name) || DEFAULT_FROM_NAME,
    },
  }
}

// Saved settings are read for every email; a change reaches every server within a minute
const CACHE_MS = 60_000
let cached: { value: { settings: PlatformEmailSettings | null; source: PlatformEmailSource }; at: number } | null = null

/** The mailbox platform emails go out from right now, and where its settings came from. */
export async function getPlatformEmailSettings(): Promise<{ settings: PlatformEmailSettings | null; source: PlatformEmailSource }> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value

  let saved: PlatformEmailSettings | null = null
  try {
    saved = (await loadSavedSettings()).settings
  } catch (err) {
    console.warn('[Platform Email] Could not read the saved mailbox; using the environment:', err)
  }
  const environment = saved ? null : settingsFromEnvironment()
  const value = saved
    ? { settings: saved, source: 'admin_panel' as const }
    : environment
      ? { settings: environment, source: 'environment' as const }
      : { settings: null, source: 'none' as const }
  cached = { value, at: Date.now() }
  return value
}

export function forgetCachedPlatformEmailSettings() {
  cached = null
}

/** A sender name safe for the From header: no line breaks, quotes or angle brackets. */
export function cleanFromName(value: unknown): string {
  return String(value ?? '').replace(/[\r\n"<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
}

export function formatFrom(settings: Pick<PlatformEmailSettings, 'fromName' | 'user'>): string {
  return `"${cleanFromName(settings.fromName) || DEFAULT_FROM_NAME}" <${settings.user}>`
}

/**
 * Checks what an admin entered. A blank password keeps `existingPassword`, which callers only pass
 * when the email address is the one it belongs to.
 */
export function validatePlatformEmailInput(
  input: Record<string, unknown> | null | undefined,
  existingPassword?: string
): { settings?: PlatformEmailSettings; error?: string } {
  const host = String(input?.host ?? '').trim().toLowerCase()
  const port = Number(input?.port)
  const user = String(input?.user ?? '').trim()
  const password = String(input?.password ?? '') || existingPassword || ''

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) || host.length > 253) {
    return { error: 'Enter the mail server name, for example smtpout.secureserver.net.' }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'Enter the server port, usually 465 (SSL) or 587 (STARTTLS).' }
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(user) || user.length > 254) return { error: 'Enter the full email address of the mailbox.' }
  if (!password) return { error: 'Enter the mailbox password.' }

  return {
    settings: {
      host,
      port,
      secure: typeof input?.secure === 'boolean' ? input.secure : port === 465,
      user,
      password,
      fromName: cleanFromName(input?.fromName) || DEFAULT_FROM_NAME,
    },
  }
}

/** A mail server error in words an admin can act on, keeping the server's own message for support. */
export function describeSmtpError(err: any): { message: string; hint: string | null; code: string | null } {
  const code = err?.code ? String(err.code) : null
  const responseCode = Number(err?.responseCode) || null
  const message = String(err?.response || err?.message || err || 'Unknown error').slice(0, 500)

  let hint: string | null = null
  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534) {
    hint = 'The mail server refused the email address or password. Gmail needs an app password; GoDaddy and Hostinger need the mailbox password.'
  } else if (/wrong version number|ssl routines/i.test(message) || /greeting never received/i.test(message)) {
    // SSL spoken to a STARTTLS port answers "wrong version number"; plain text to an SSL port gets no greeting
    hint = 'The security setting does not match the port: use SSL with port 465, or STARTTLS with port 587.'
  } else if (/ENOTFOUND|EAI_AGAIN/.test(message) || code === 'EDNS') {
    hint = 'The server name was not found. Check its spelling.'
  } else if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET' || /ECONNREFUSED|timeout/i.test(message)) {
    hint = 'The mail server could not be reached on this port. Check the server name and port (465 with SSL, or 587 with STARTTLS).'
  } else if (code === 'EENVELOPE' || responseCode === 550 || responseCode === 553 || responseCode === 554) {
    hint = 'The server refused the sender or recipient. Platform emails must be sent from the mailbox you sign in with.'
  }
  return { message, hint, code: code || (responseCode ? String(responseCode) : null) }
}

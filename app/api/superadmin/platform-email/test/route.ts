import { NextRequest, NextResponse } from 'next/server'
import { checkSuperAdmin, getSupabaseAdminClient } from '@/lib/superadmin-auth'
import { createSmtpTransport } from '@/lib/email'
import {
  describeSmtpError,
  formatFrom,
  forgetCachedPlatformEmailSettings,
  getPlatformEmailSettings,
  loadSavedSettings,
  settingsFromEnvironment,
  validatePlatformEmailInput,
  type PlatformEmailSettings,
} from '@/lib/platform-email'

/**
 * Sends a test email to the signed-in superadmin (never anyone else), from the mailbox in the form
 * when one is given, otherwise from the one platform emails use now. Answers with the mail server's
 * own error when it fails.
 */
export async function POST(request: NextRequest) {
  const admin = await checkSuperAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const to = String(admin.email || '').trim()
  if (!to) {
    return NextResponse.json({ success: false, error: 'Your account has no email address to send the test to.' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  let settings: PlatformEmailSettings | null = null

  if (body && typeof body === 'object' && String(body.host ?? '').trim()) {
    // The form, before it is saved. A blank password is the known one for that same mailbox.
    const user = String(body.user ?? '').trim().toLowerCase()
    const saved = (await loadSavedSettings(getSupabaseAdminClient())).settings
    const environment = settingsFromEnvironment()
    const knownPassword = [saved, environment].find((known) => known && known.user.toLowerCase() === user)?.password
    const checked = validatePlatformEmailInput(body, knownPassword)
    if (!checked.settings) {
      return NextResponse.json({ success: false, error: checked.error }, { status: 400 })
    }
    settings = checked.settings
  } else {
    forgetCachedPlatformEmailSettings()
    settings = (await getPlatformEmailSettings()).settings
  }

  if (!settings) {
    return NextResponse.json({ success: false, error: 'No platform mailbox is set up yet.' }, { status: 400 })
  }

  const server = `${settings.host}:${settings.port}`
  try {
    const transport = createSmtpTransport(settings)
    await transport.verify()
    const info = await transport.sendMail({
      from: formatFrom(settings),
      to,
      subject: `Test email from ${settings.user}`,
      text: `This is a test of the platform mailbox ${settings.user} (server ${server}). Login codes and teammate invites will be sent from it.`,
      html: `<p>This is a test of the platform mailbox <strong>${settings.user}</strong> (server ${server}).</p><p>Login codes and teammate invites will be sent from it.</p>`,
    })
    return NextResponse.json({ success: true, to, server, messageId: info.messageId })
  } catch (err: any) {
    const { message, hint, code } = describeSmtpError(err)
    console.warn('[Platform Email] Test email failed:', { server, code, message })
    return NextResponse.json({ success: false, to, server, error: message, hint, code })
  }
}

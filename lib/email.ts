import nodemailer from 'nodemailer'
import { formatFrom, getPlatformEmailSettings, type PlatformEmailSettings } from '@/lib/platform-email'

/** A mail transport that signs in to one mailbox. */
export function createSmtpTransport(settings: PlatformEmailSettings) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    auth: {
      user: settings.user,
      pass: settings.password,
    },
  })
}

/**
 * Sends one of the platform's own emails from the platform mailbox (set in the superadmin panel,
 * otherwise in the environment), with fallback to SendGrid if configured
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  attachments,
}: {
  to: string
  subject: string
  html: string
  text?: string
  attachments?: Array<{ filename: string; content: string | Buffer; contentType?: string }>
}) {
  let smtpError: any = null

  // 1. Try the platform mailbox
  const { settings, source } = await getPlatformEmailSettings()
  if (settings) {
    try {
      const mailOptions: any = {
        from: formatFrom(settings),
        to,
        subject,
        text: text || '',
        html,
      }

      if (attachments && attachments.length > 0) {
        mailOptions.attachments = attachments
      }

      const info = await createSmtpTransport(settings).sendMail(mailOptions)
      console.log(`[Email] Email sent successfully via SMTP (${source}):`, info.messageId)
      return { success: true, provider: 'smtp', messageId: info.messageId }
    } catch (error: any) {
      smtpError = error
      console.warn('[Email] SMTP failed, attempting fallback if available:', error?.message || error)
    }
  } else {
    smtpError = new Error('No platform mailbox is set up (superadmin panel > Platform Email, or PLATFORM_SMTP_* variables).')
  }

  // 2. Fallback to SendGrid if available in environment
  const sendgridApiKey = process.env.SENDGRID_API_KEY
  const sendgridFromEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@consularhelpdesk.com'

  if (sendgridApiKey) {
    try {
      const payload: any = {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: sendgridFromEmail, name: 'OmniCRM Security' },
        subject,
        content: [
          { type: 'text/html', value: html },
          ...(text ? [{ type: 'text/plain', value: text }] : []),
        ],
      }

      if (attachments && attachments.length > 0) {
        payload.attachments = attachments.map(att => ({
          content: typeof att.content === 'string' ? Buffer.from(att.content).toString('base64') : att.content.toString('base64'),
          filename: att.filename,
          type: att.contentType || 'text/plain',
          disposition: 'attachment',
        }))
      }

      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sendgridApiKey}`,
        },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        console.log('[Email] Email sent successfully via SendGrid fallback')
        return { success: true, provider: 'sendgrid' }
      } else {
        const errorText = await res.text()
        console.error('[Email] SendGrid fallback failed:', errorText)
      }
    } catch (sgError) {
      console.error('[Email] SendGrid fallback error:', sgError)
    }
  }

  // If both failed, throw the original SMTP error
  throw smtpError || new Error('All email delivery methods failed.')
}

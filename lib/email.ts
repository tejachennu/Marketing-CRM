import nodemailer from 'nodemailer'

/**
 * Creates and returns the nodemailer transporter configured with the Hostinger SMTP server
 * from the environment variables.
 */
export function getMailTransporter() {
  const host = process.env.HOSTINGER_SMTP_HOST || 'smtp.hostinger.com'
  const port = parseInt(process.env.HOSTINGER_SMTP_PORT || '465', 10)
  const secure = process.env.HOSTINGER_SMTP_SECURE === 'true'
  const user = process.env.HOSTINGER_SMTP_USER || 'noreply@consularhelpdesk.com'
  const pass = process.env.HOSTINGER_SMTP_PASS || '**Noreply20#'

  return nodemailer.createTransport({
    host,
    port,
    secure,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    auth: {
      user,
      pass,
    },
  })
}

/**
 * Sends an email using the Hostinger SMTP transporter, with fallback to SendGrid if configured
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

  // 1. Try Nodemailer Transporter
  try {
    const transporter = getMailTransporter()
    const fromUser = process.env.HOSTINGER_SMTP_USER || process.env.SMTP_USER || process.env.SMTP_EMAIL || 'noreply@consularhelpdesk.com'
    
    const mailOptions: any = {
      from: `"OmniCRM Security" <${fromUser}>`,
      to,
      subject,
      text: text || '',
      html,
    }

    if (attachments && attachments.length > 0) {
      mailOptions.attachments = attachments
    }

    const info = await transporter.sendMail(mailOptions)
    console.log('[Email] Email sent successfully via SMTP:', info.messageId)
    return { success: true, provider: 'smtp', messageId: info.messageId }
  } catch (error: any) {
    smtpError = error
    console.warn('[Email] SMTP failed, attempting fallback if available:', error?.message || error)
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

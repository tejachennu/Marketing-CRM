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
    auth: {
      user,
      pass,
    },
  })
}

/**
 * Sends an email using the Hostinger SMTP transporter
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string
  subject: string
  html: string
  text?: string
}) {
  try {
    const transporter = getMailTransporter()
    const fromUser = process.env.HOSTINGER_SMTP_USER || 'noreply@consularhelpdesk.com'
    
    const info = await transporter.sendMail({
      from: `"OmniCRM Security" <${fromUser}>`,
      to,
      subject,
      text: text || '',
      html,
    })
    console.log('[Email] Email sent successfully:', info.messageId)
    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error('[Email] Failed to send email:', error)
    throw error
  }
}

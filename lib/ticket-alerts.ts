/**
 * The ticket alert email: when a new ticket is raised, the people the business picked (Settings →
 * Chat and tickets) get an email. Sent from the business's own mailbox when it has one set up
 * (SendGrid or SMTP), otherwise from WAMA CRM's platform mailbox. Never throws.
 */

import nodemailer from 'nodemailer'
import { escapeHtml } from './utils'

export interface TicketAlert {
  organizationId: string
  ticketId: string
  ticketSubject: string
  contactName?: string | null
  contactPhone?: string | null
}

export async function emailTicketAlert(db: any, input: TicketAlert, appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://wamacrm.magnetora.in'): Promise<{ sent: boolean; count?: number; reason?: string }> {
  try {
    const { organizationId, ticketId } = input
    const ticketSubject = String(input.ticketSubject || 'Support Request').replace(/\s+/g, ' ').trim().slice(0, 140)
    const contactName = input.contactName
    const contactPhone = input.contactPhone
    const { data: org } = await db
      .from('organizations')
      .select('name, ticket_email_enabled, ticket_email_recipients, email_provider, sendgrid_api_key, sendgrid_from_email, smtp_host, smtp_port, smtp_email, smtp_password')
      .eq('id', organizationId)
      .maybeSingle()
    if (!org) return { sent: false, reason: 'org_not_found' }
    if (!org.ticket_email_enabled) return { sent: false, reason: 'notifications_disabled' }
    const recipientIds: string[] = Array.isArray(org.ticket_email_recipients) ? org.ticket_email_recipients : []
    if (!recipientIds.length) return { sent: false, reason: 'no_recipients' }
    const { data: users } = await db.from('users').select('email, full_name').eq('organization_id', organizationId).in('id', recipientIds)
    const people = (users || []).filter((user: any) => user.email)
    if (!people.length) return { sent: false, reason: 'no_valid_recipients' }

    const orgName = org.name || 'Support'
    const emailSubject = `New ticket: ${ticketSubject}`
    const timestamp = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
    const dashboardUrl = `${appUrl.replace(/\/$/, '')}/dashboard/tickets`
    const safe = {
      orgName: escapeHtml(orgName),
      emailSubject: escapeHtml(emailSubject),
      ticketSubject: escapeHtml(ticketSubject),
      contactName: escapeHtml(contactName || 'N/A'),
      contactPhone: escapeHtml(contactPhone || 'N/A'),
      ticketId: escapeHtml(ticketId),
      dashboardUrl: escapeHtml(dashboardUrl),
    }
    const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safe.emailSubject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          
          <!-- Header -->
          <tr>
            <td style="background-color:#00a884;padding:28px 32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.3px;">
                ${safe.orgName}
              </h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.9);font-size:14px;font-weight:400;">
                New Support Ticket Received
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 20px;color:#111b21;font-size:15px;line-height:1.6;">
                A new support ticket has been submitted and needs your attention.
              </p>

              <!-- Ticket Details Card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #e0e0e0;">
                          <span style="color:#667781;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Subject</span><br />
                          <span style="color:#111b21;font-size:15px;font-weight:600;">${safe.ticketSubject}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #e0e0e0;">
                          <span style="color:#667781;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Customer Name</span><br />
                          <span style="color:#111b21;font-size:15px;">${safe.contactName}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #e0e0e0;">
                          <span style="color:#667781;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Customer Phone</span><br />
                          <span style="color:#111b21;font-size:15px;">${safe.contactPhone}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="color:#667781;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Received At</span><br />
                          <span style="color:#111b21;font-size:15px;">${timestamp}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 16px;">
                    <a href="${safe.dashboardUrl}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-block;background-color:#00a884;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 36px;border-radius:8px;letter-spacing:0.3px;">
                      View Ticket in Dashboard
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:16px 0 0;color:#667781;font-size:13px;line-height:1.5;text-align:center;">
                Ticket ID: <span style="font-family:monospace;color:#111b21;">${safe.ticketId}</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f0f2f5;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;">
              <p style="margin:0;color:#667781;font-size:12px;line-height:1.5;">
                This is an automated notification from ${safe.orgName}.<br />
                Please do not reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

    const provider = org.email_provider === 'smtp' ? 'smtp' : 'sendgrid'
    const ownSendgrid = provider === 'sendgrid' && org.sendgrid_api_key && org.sendgrid_from_email
    const ownSmtp = provider === 'smtp' && org.smtp_host && org.smtp_port && org.smtp_email && org.smtp_password
    let count = 0
    for (const person of people) {
      try {
        if (ownSendgrid) {
          const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: { Authorization: `Bearer ${org.sendgrid_api_key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ personalizations: [{ to: [{ email: person.email }] }], from: { email: org.sendgrid_from_email, name: orgName }, subject: emailSubject, content: [{ type: 'text/html', value: htmlBody }] }),
          })
          if (res.ok || res.status === 202) count++
          else console.warn('[Ticket alert] SendGrid refused:', res.status)
        } else if (ownSmtp) {
          const port = parseInt(String(org.smtp_port), 10)
          await nodemailer.createTransport({ host: org.smtp_host, port, secure: port === 465, auth: { user: org.smtp_email, pass: org.smtp_password } })
            .sendMail({ from: `"${orgName.replace(/"/g, '')}" <${org.smtp_email}>`, to: person.email, subject: emailSubject, html: htmlBody })
          count++
        } else {
          // No mailbox of its own: WAMA CRM's platform mailbox sends it
          const { sendEmail } = await import('./email')
          await sendEmail({ to: person.email, subject: emailSubject, html: htmlBody, text: `${emailSubject}\n${contactName || ''} ${contactPhone || ''}\n${dashboardUrl}` })
          count++
        }
      } catch (error: any) {
        console.warn('[Ticket alert] Email not sent:', error?.message)
      }
    }
    return { sent: count > 0, count }
  } catch (error: any) {
    console.warn('[Ticket alert] Could not send:', error?.message)
    return { sent: false, reason: 'internal_error' }
  }
}

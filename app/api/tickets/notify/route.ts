import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

export async function POST(request: Request) {
  try {
    const { organizationId, ticketSubject, contactName, contactPhone, ticketId } =
      await request.json()

    if (!organizationId || !ticketSubject || !ticketId) {
      return NextResponse.json(
        { sent: false, reason: 'missing_fields' },
        { status: 400 }
      )
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // ── 1. Fetch organization settings ──────────────────────────────────
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select(
        'name, ticket_email_enabled, ticket_email_recipients, email_provider, sendgrid_api_key, sendgrid_from_email, smtp_host, smtp_port, smtp_email, smtp_password'
      )
      .eq('id', organizationId)
      .single()

    if (orgError || !org) {
      console.error('Failed to fetch organization:', orgError)
      return NextResponse.json(
        { sent: false, reason: 'org_not_found' },
        { status: 404 }
      )
    }

    if (!org.ticket_email_enabled) {
      return NextResponse.json({ sent: false, reason: 'notifications_disabled' })
    }

    const recipientIds: string[] = org.ticket_email_recipients ?? []
    if (recipientIds.length === 0) {
      return NextResponse.json({ sent: false, reason: 'no_recipients' })
    }

    // ── 2. Validate email credentials ───────────────────────────────────
    const provider: 'sendgrid' | 'smtp' = org.email_provider ?? 'sendgrid'

    if (provider === 'sendgrid' && (!org.sendgrid_api_key || !org.sendgrid_from_email)) {
      return NextResponse.json({ sent: false, reason: 'no_credentials' })
    }

    if (
      provider === 'smtp' &&
      (!org.smtp_host || !org.smtp_port || !org.smtp_email || !org.smtp_password)
    ) {
      return NextResponse.json({ sent: false, reason: 'no_credentials' })
    }

    // ── 3. Fetch recipient emails ───────────────────────────────────────
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('email, full_name')
      .in('id', recipientIds)

    if (usersError || !users || users.length === 0) {
      console.error('Failed to fetch recipient users:', usersError)
      return NextResponse.json({ sent: false, reason: 'no_valid_recipients' })
    }

    // ── 4. Build the HTML email ─────────────────────────────────────────
    const orgName = org.name || 'Support'
    const emailSubject = `🎫 New Support Ticket: ${ticketSubject}`
    const timestamp = new Date().toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
    const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.example.com'}/tickets`

    const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${emailSubject}</title>
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
                ${orgName}
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
                          <span style="color:#111b21;font-size:15px;font-weight:600;">${ticketSubject}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #e0e0e0;">
                          <span style="color:#667781;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Customer Name</span><br />
                          <span style="color:#111b21;font-size:15px;">${contactName || 'N/A'}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #e0e0e0;">
                          <span style="color:#667781;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Customer Phone</span><br />
                          <span style="color:#111b21;font-size:15px;">${contactPhone || 'N/A'}</span>
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
                    <a href="${dashboardUrl}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-block;background-color:#00a884;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 36px;border-radius:8px;letter-spacing:0.3px;">
                      View Ticket in Dashboard
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:16px 0 0;color:#667781;font-size:13px;line-height:1.5;text-align:center;">
                Ticket ID: <span style="font-family:monospace;color:#111b21;">${ticketId}</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f0f2f5;padding:20px 32px;text-align:center;border-top:1px solid #e0e0e0;">
              <p style="margin:0;color:#667781;font-size:12px;line-height:1.5;">
                This is an automated notification from ${orgName}.<br />
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

    // ── 5. Send emails ──────────────────────────────────────────────────
    let successCount = 0

    if (provider === 'sendgrid') {
      const apiKey = org.sendgrid_api_key!
      const fromEmail = org.sendgrid_from_email!

      for (const user of users) {
        try {
          const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: user.email }] }],
              from: { email: fromEmail, name: orgName },
              subject: emailSubject,
              content: [{ type: 'text/html', value: htmlBody }],
            }),
          })

          if (res.ok || res.status === 202) {
            successCount++
          } else {
            const errBody = await res.text()
            console.error(
              `SendGrid failed for ${user.email}: ${res.status}`,
              errBody
            )
          }
        } catch (err) {
          console.error(`SendGrid error for ${user.email}:`, err)
        }
      }
    } else {
      // SMTP via nodemailer
      const transporter = nodemailer.createTransport({
        host: org.smtp_host!,
        port: parseInt(org.smtp_port!),
        secure: parseInt(org.smtp_port!) === 465,
        auth: {
          user: org.smtp_email!,
          pass: org.smtp_password!,
        },
      })

      for (const user of users) {
        try {
          await transporter.sendMail({
            from: `"${orgName}" <${org.smtp_email}>`,
            to: user.email,
            subject: emailSubject,
            html: htmlBody,
          })
          successCount++
        } catch (err) {
          console.error(`SMTP error for ${user.email}:`, err)
        }
      }
    }

    return NextResponse.json({ sent: true, count: successCount })
  } catch (error) {
    console.error('Ticket notification error:', error)
    return NextResponse.json(
      { sent: false, reason: 'internal_error' },
      { status: 500 }
    )
  }
}

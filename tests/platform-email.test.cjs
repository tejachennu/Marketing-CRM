// The platform mailbox (login codes, teammate invites): settings, checks and the superadmin routes,
// against a fake database and a fake mail server. Nothing is sent and no real database is touched.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PROJECT = path.join(__dirname, '..')
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

// Fake database holding the one settings row
let row = null
let tableExists = true
const MISSING = { code: 'PGRST205', message: "Could not find the table 'public.platform_email_settings' in the schema cache" }
const fakeDb = {
  from() {
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => (tableExists ? { data: row, error: null } : { data: null, error: MISSING }) }) }),
      upsert: async (values) => { if (!tableExists) return { error: MISSING }; row = { ...values }; return { error: null } },
      delete: () => ({ eq: async () => { row = null; return { error: null } } }),
    }
  },
}
let admin = { id: 'admin-1', email: 'owner@magnetora.in' }
stub(path.join(PROJECT, 'lib/api-auth-helper.ts'), { getSupabaseAdminClient: () => fakeDb })
stub(path.join(PROJECT, 'lib/superadmin-auth.ts'), { checkSuperAdmin: async () => admin, getSupabaseAdminClient: () => fakeDb })

// Fake mail server: records what would be sent, or fails like a real one
let sent = []
let failWith = null
stub(require.resolve('nodemailer', { paths: [PROJECT] }), {
  createTransport: (options) => ({
    verify: async () => { if (failWith) throw failWith; return true },
    sendMail: async (mail) => { if (failWith) throw failWith; sent.push({ options, mail }); return { messageId: '<test@local>' } },
  }),
})

for (const level of ['log', 'warn']) {
  const original = console[level]
  console[level] = (...args) => { if (!/^\[(Platform Email|Email)\]/.test(String(args[0]))) original(...args) }
}

const platform = require(path.join(PROJECT, 'lib/platform-email.ts'))
const { SMTP_PRESETS, presetForHost } = require(path.join(PROJECT, 'lib/smtp-presets.ts'))
const settingsRoute = require(path.join(PROJECT, 'app/api/superadmin/platform-email/route.ts'))
const testRoute = require(path.join(PROJECT, 'app/api/superadmin/platform-email/test/route.ts'))
const { sendEmail } = require(path.join(PROJECT, 'lib/email.ts'))
const { NextRequest } = require(require.resolve('next/server', { paths: [PROJECT] }))

const request = (method, body) => new NextRequest('https://wamacrm.example.com/api/superadmin/platform-email', { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
const GODADDY = { host: 'smtpout.secureserver.net', port: 465, secure: true, user: 'info@magnetora.in', password: 'mailbox-password', fromName: 'WAMACRM' }

function reset(env = {}) {
  row = null; tableExists = true; sent = []; failWith = null; admin = { id: 'admin-1', email: 'owner@magnetora.in' }
  for (const name of Object.keys(process.env)) if (/^(PLATFORM_SMTP_|HOSTINGER_SMTP_|PLATFORM_EMAIL_|SENDGRID_)/.test(name)) delete process.env[name]
  Object.assign(process.env, env)
  platform.forgetCachedPlatformEmailSettings()
}

test('Platform email: the environment mailbox, never mixing the old and new variable names', () => {
  const old = { HOSTINGER_SMTP_HOST: 'smtp.hostinger.com', HOSTINGER_SMTP_PORT: '465', HOSTINGER_SMTP_SECURE: 'true', HOSTINGER_SMTP_USER: 'noreply@consularhelpdesk.com', HOSTINGER_SMTP_PASS: 'old-pass' }
  assert.deepEqual(platform.settingsFromEnvironment(old), { host: 'smtp.hostinger.com', port: 465, secure: true, user: 'noreply@consularhelpdesk.com', password: 'old-pass', fromName: 'OmniCRM Security' })
  // Any PLATFORM_SMTP_* switches to that set entirely: no old password sent with the new address
  assert.equal(platform.settingsFromEnvironment({ ...old, PLATFORM_SMTP_USER: 'info@magnetora.in' }), null)
  const fresh = platform.settingsFromEnvironment({ ...old, PLATFORM_SMTP_HOST: 'smtp.office365.com', PLATFORM_SMTP_PORT: '587', PLATFORM_SMTP_USER: 'info@magnetora.in', PLATFORM_SMTP_PASS: 'new-pass', PLATFORM_EMAIL_FROM_NAME: 'WAMACRM' })
  assert.deepEqual(fresh, { host: 'smtp.office365.com', port: 587, secure: false, user: 'info@magnetora.in', password: 'new-pass', fromName: 'WAMACRM' })
  assert.equal(platform.settingsFromEnvironment({ HOSTINGER_SMTP_USER: 'noreply@consularhelpdesk.com' }), null, 'no password, no mailbox')
})

test('Platform email: what an admin enters is checked, and the sender name cannot break the header', () => {
  assert.match(platform.validatePlatformEmailInput({ ...GODADDY, host: 'not a host' }).error, /mail server name/)
  assert.match(platform.validatePlatformEmailInput({ ...GODADDY, port: 70000 }).error, /port/)
  assert.match(platform.validatePlatformEmailInput({ ...GODADDY, user: 'info' }).error, /full email address/)
  assert.match(platform.validatePlatformEmailInput({ ...GODADDY, password: '' }).error, /password/)
  assert.equal(platform.validatePlatformEmailInput({ ...GODADDY, password: '' }, 'kept').settings.password, 'kept')
  const injected = platform.validatePlatformEmailInput({ ...GODADDY, fromName: 'Evil"\r\nBcc: victim@example.com <x>' }).settings
  assert.ok(!/[\r\n"<>]/.test(injected.fromName))
  assert.equal(platform.formatFrom(injected), `"${injected.fromName}" <info@magnetora.in>`)
})

test('Platform email: mail server errors come with a hint an admin can act on', () => {
  assert.match(platform.describeSmtpError({ code: 'EAUTH', responseCode: 535, response: '535 Authentication failed' }).hint, /refused the email address or password/)
  assert.match(platform.describeSmtpError({ code: 'ESOCKET', message: 'ssl3_get_record:wrong version number' }).hint, /SSL with port 465/)
  assert.match(platform.describeSmtpError({ code: 'ETIMEDOUT', message: 'Greeting never received' }).hint, /SSL with port 465/)
  assert.match(platform.describeSmtpError({ code: 'EDNS', message: 'getaddrinfo ENOTFOUND smtp.example.invalid' }).hint, /not found/)
  assert.equal(platform.describeSmtpError({ code: 'EAUTH', response: '535 Authentication failed' }).message, '535 Authentication failed')
})

test('Platform email: presets fill in the documented servers', () => {
  assert.equal(presetForHost('smtpout.secureserver.net').id, 'godaddy')
  assert.equal(presetForHost(' SMTP.GMAIL.COM ').id, 'google')
  assert.equal(presetForHost('mail.example.com'), null)
  for (const preset of SMTP_PRESETS) assert.equal(preset.secure, preset.port === 465, preset.id)
})

test('Platform email route: the panel never sees the password', async () => {
  reset({ HOSTINGER_SMTP_USER: 'noreply@consularhelpdesk.com', HOSTINGER_SMTP_PASS: 'old-pass' })
  const data = await (await settingsRoute.GET(request('GET'))).json()
  assert.equal(data.source, 'environment')
  assert.equal(data.environment.user, 'noreply@consularhelpdesk.com')
  assert.equal(data.environment.hasPassword, true)
  assert.ok(!JSON.stringify(data).includes('old-pass'))
})

test('Platform email route: saving needs the password again for a different mailbox, not the same one', async () => {
  reset()
  let res = await settingsRoute.PUT(request('PUT', GODADDY))
  assert.equal(res.status, 200)
  assert.equal(row.smtp_user, 'info@magnetora.in')
  assert.equal(row.smtp_password, 'mailbox-password')
  assert.equal(row.updated_by, 'admin-1')
  assert.ok(!JSON.stringify(await res.json()).includes('mailbox-password'))

  res = await settingsRoute.PUT(request('PUT', { ...GODADDY, password: '', fromName: 'Magnetora' }))
  assert.equal(res.status, 200, 'same mailbox: the saved password is kept')
  assert.equal(row.smtp_password, 'mailbox-password')
  assert.equal(row.from_name, 'Magnetora')

  res = await settingsRoute.PUT(request('PUT', { ...GODADDY, user: 'sales@magnetora.in', password: '' }))
  assert.equal(res.status, 400, "another mailbox never gets this one's password")
})

test('Platform email route: without the table, saving explains the migration and emails use the environment', async () => {
  reset({ HOSTINGER_SMTP_USER: 'noreply@consularhelpdesk.com', HOSTINGER_SMTP_PASS: 'old-pass' })
  tableExists = false
  const res = await settingsRoute.PUT(request('PUT', GODADDY))
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /20261016_platform_email_settings\.sql/)
  assert.equal((await platform.getPlatformEmailSettings()).source, 'environment')
})

test('Platform email: login codes go out from the mailbox saved in the panel', async () => {
  reset({ HOSTINGER_SMTP_USER: 'noreply@consularhelpdesk.com', HOSTINGER_SMTP_PASS: 'old-pass' })
  await settingsRoute.PUT(request('PUT', GODADDY))
  await sendEmail({ to: 'user@example.com', subject: '123456 is your code', html: '<p>123456</p>' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].mail.from, '"WAMACRM" <info@magnetora.in>')
  assert.deepEqual(sent[0].options.auth, { user: 'info@magnetora.in', pass: 'mailbox-password' })
  assert.equal(sent[0].options.host, 'smtpout.secureserver.net')
})

test('Platform email test route: only ever mails the signed-in admin, and reports the server error', async () => {
  reset()
  let data = await (await testRoute.POST(request('POST', { ...GODADDY, to: 'someone-else@example.com' }))).json()
  assert.equal(data.success, true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].mail.to, 'owner@magnetora.in')

  failWith = Object.assign(new Error('Invalid login: 535 Authentication failed'), { code: 'EAUTH', responseCode: 535, response: '535 Authentication failed' })
  data = await (await testRoute.POST(request('POST', GODADDY))).json()
  assert.equal(data.success, false)
  assert.equal(data.code, 'EAUTH')
  assert.match(data.hint, /password/)
  assert.equal(data.server, 'smtpout.secureserver.net:465')
})

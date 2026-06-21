const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

// Load .env
const envPath = path.join(__dirname, '..', '.env')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach((line) => {
  const match = line.match(/^([^=]+)=\s*'?(.*?)'?\s*$/)
  if (match) env[match[1].trim()] = match[2]
})

const POSTGRES_URL = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL not found in .env')
  process.exit(1)
}

async function run() {
  console.log('🔌 Connecting to database...')
  const cleanUrl = POSTGRES_URL.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]supa=[^&]*/g, '')
  const client = new Client({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  console.log('✅ Connected\n')

  console.log('🛠️ Adding credential config columns to organizations table...')
  await client.query(`
    ALTER TABLE public.organizations 
    ADD COLUMN IF NOT EXISTS twilio_account_sid TEXT,
    ADD COLUMN IF NOT EXISTS twilio_auth_token TEXT,
    ADD COLUMN IF NOT EXISTS twilio_whatsapp_number TEXT,
    ADD COLUMN IF NOT EXISTS sendgrid_api_key TEXT,
    ADD COLUMN IF NOT EXISTS sendgrid_from_email TEXT,
    ADD COLUMN IF NOT EXISTS openai_api_key TEXT;
  `)
  console.log('   ✅ Credential config columns added successfully')

  await client.end()
  console.log('\n🚀 Database migration V12 complete!')
}

run().catch((err) => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})

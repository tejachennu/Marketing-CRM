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

  console.log('🛠️ Adding feature toggles columns to organizations table...')
  await client.query(`
    ALTER TABLE public.organizations 
    ADD COLUMN IF NOT EXISTS enable_ai BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS enable_email BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS enable_messages BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS enable_phone_calls BOOLEAN DEFAULT true;
  `)
  console.log('   ✅ Toggles columns added successfully')

  await client.end()
  console.log('\n🚀 Database migration V11 complete!')
}

run().catch((err) => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})

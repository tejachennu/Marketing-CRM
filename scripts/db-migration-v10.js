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

  console.log('🛠️ Altering campaigns and campaign_logs tables to support multi-channel campaigns...')
  
  // 1. Alter campaigns table
  await client.query(`
    ALTER TABLE public.campaigns 
    ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp',
    ADD COLUMN IF NOT EXISTS sender TEXT,
    ADD COLUMN IF NOT EXISTS subject TEXT;
  `)
  console.log('   - Campaigns columns (channel, sender, subject) ready')

  // 2. Alter campaign_logs table
  await client.query(`
    ALTER TABLE public.campaign_logs 
    ALTER COLUMN phone_number DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS email_address TEXT;
  `)
  console.log('   - Campaign logs columns (phone_number nullable, email_address) ready')

  await client.end()
  console.log('\n🚀 Database migration V10 complete!')
}

run().catch((err) => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})

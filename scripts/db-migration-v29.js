const { Client } = require('pg')
const fs = require('fs')
const path = require('path')
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let envContent = ''
try {
  envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
} catch (e) {
  try {
    envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  } catch (e2) {}
}

const env = {}
if (envContent) {
  envContent.split('\n').forEach((line) => {
    const match = line.match(/^([^=]+)=\s*'?(.*?)'?\s*$/)
    if (match) env[match[1].trim()] = match[2]
  })
}

const POSTGRES_URL = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.DATABASE_URL
if (!POSTGRES_URL) {
  console.log('ℹ️ No POSTGRES_URL found in environment, migration script will skip direct DB query.')
  process.exit(0)
}

const client = new Client({
  connectionString: POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
})

async function run() {
  try {
    await client.connect()
    console.log('✅ Connected to database')
    
    // Add scheduled_at to campaigns
    console.log('Checking scheduled_at column on campaigns table...')
    await client.query(`
      ALTER TABLE public.campaigns 
      ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

      CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled_at 
      ON public.campaigns(scheduled_at) 
      WHERE status = 'SCHEDULED';
    `)
    console.log('✅ Column scheduled_at & index added/verified on campaigns table!')
  } catch (err) {
    console.error('❌ Error:', err)
  } finally {
    await client.end()
  }
}

run()

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
  console.log('ℹ️ No POSTGRES_URL found in environment, skipping direct DB query.')
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
    
    console.log('Checking tags column on contacts table...')
    await client.query(`
      ALTER TABLE public.contacts 
      ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

      CREATE INDEX IF NOT EXISTS idx_contacts_tags 
      ON public.contacts USING GIN (tags);
    `)
    console.log('✅ Column tags (TEXT[]) and GIN index verified on contacts table!')
  } catch (err) {
    console.error('❌ Migration error:', err)
  } finally {
    await client.end()
  }
}

run()

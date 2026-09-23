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
  console.log('ℹ️ No POSTGRES_URL found in environment.')
  process.exit(1)
}

const client = new Client({
  connectionString: POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
})

async function run() {
  try {
    await client.connect()
    console.log('✅ Connected to database')
    
    console.log('Adding fallback_settings column to whatsapp_workflows...')
    await client.query(`
      ALTER TABLE public.whatsapp_workflows 
      ADD COLUMN IF NOT EXISTS fallback_settings JSONB DEFAULT '{"rag_enabled": true, "max_ai_turns": 3, "auto_resume_prompt": true}'::jsonb;

      -- Reload Supabase PostgREST schema cache
      NOTIFY pgrst, 'reload schema';
    `)
    console.log('✅ fallback_settings column added and PostgREST schema reloaded successfully!')
  } catch (err) {
    console.error('❌ Error updating database schema:', err)
  } finally {
    await client.end()
  }
}

run()

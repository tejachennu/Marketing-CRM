const { Client } = require('pg')
const fs = require('fs')
const path = require('path')
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let envContent = ''
try {
  envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
} catch (e) {
  envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
}

const env = {}
envContent.split('\n').forEach((line) => {
  const match = line.match(/^([^=]+)=\s*'?(.*?)'?\s*$/)
  if (match) env[match[1].trim()] = match[2]
})

const POSTGRES_URL = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.DATABASE_URL
const client = new Client({
  connectionString: POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
})

async function run() {
  try {
    await client.connect()
    console.log('✅ Connected to database')
    
    // Add template_language to campaigns
    console.log('Checking template_language column on campaigns table...')
    await client.query(`
      ALTER TABLE public.campaigns 
      ADD COLUMN IF NOT EXISTS template_language VARCHAR(20) DEFAULT 'en';
    `)
    console.log('✅ Column template_language added/verified on campaigns table!')
  } catch (err) {
    console.error('❌ Error:', err)
  } finally {
    await client.end()
  }
}

run()

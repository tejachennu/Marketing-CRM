const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

// Load .env
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

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL not found')
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
    
    const checkRes = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='tickets' AND column_name='assigned_to';
    `)

    if (checkRes.rows.length === 0) {
      console.log('Adding assigned_to column to tickets...')
      await client.query(`
        ALTER TABLE public.tickets 
        ADD COLUMN assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL;
      `)
      console.log('✅ Column assigned_to added!')
    } else {
      console.log('✅ Column assigned_to already exists.')
    }
  } catch (err) {
    console.error('❌ Error:', err)
  } finally {
    await client.end()
  }
}

run()

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
    
    // 1. Add currency to organizations
    const checkOrgRes = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='organizations' AND column_name='currency';
    `)

    if (checkOrgRes.rows.length === 0) {
      console.log('Adding currency column to organizations...')
      await client.query(`
        ALTER TABLE public.organizations 
        ADD COLUMN currency VARCHAR(10) DEFAULT 'USD';
      `)
      console.log('✅ Column currency added to organizations!')
    } else {
      console.log('✅ Column currency already exists in organizations.')
    }

    // 2. Create lead_activities table
    console.log('Creating lead_activities table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.lead_activities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
        lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
        user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
        activity_type VARCHAR(50) NOT NULL,
        content TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `)
    console.log('✅ Table lead_activities created!')
  } catch (err) {
    console.error('❌ Error:', err)
  } finally {
    await client.end()
  }
}

run()

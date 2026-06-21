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

  console.log('🛠️ Creating live_stream_calls table...')
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.live_stream_calls (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
      call_sid TEXT UNIQUE NOT NULL,
      phone_number TEXT,
      custom_prompt TEXT,
      extracted_variables JSONB DEFAULT '{}'::jsonb,
      status TEXT DEFAULT 'initiated',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `)
  console.log('   ✅ Table public.live_stream_calls ready')

  console.log('🛡️ Configuring security and permissions...')
  await client.query(`ALTER TABLE public.live_stream_calls DISABLE ROW LEVEL SECURITY;`)
  await client.query(`GRANT ALL ON TABLE public.live_stream_calls TO postgres, service_role, anon, authenticated;`)
  console.log('   ✅ RLS disabled and permissions granted')

  await client.end()
  console.log('\n🚀 Database migration V8 complete!')
}

run().catch((err) => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})

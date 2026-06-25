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

  console.log('🛠️ Creating tickets table...')
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
      conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
      contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'open',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
    );
  `)
  console.log('   ✅ Table public.tickets created or already exists.')

  console.log('🔓 Disabling RLS and granting permissions on public.tickets...')
  await client.query(`ALTER TABLE public.tickets DISABLE ROW LEVEL SECURITY;`)
  await client.query(`GRANT ALL ON public.tickets TO anon;`)
  await client.query(`GRANT ALL ON public.tickets TO authenticated;`)
  console.log('   ✅ RLS disabled and permissions granted.')

  console.log('⚡ Enabling Supabase Realtime on public.tickets...')
  try {
    await client.query(`ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;`)
    console.log('   ✅ Added public.tickets to supabase_realtime publication.')
  } catch (err) {
    if (err.message.includes('already member')) {
      console.log('   ✅ public.tickets already in realtime publication.')
    } else {
      console.error('   ❌ Error adding table to publication:', err.message)
    }
  }

  try {
    await client.query(`ALTER TABLE public.tickets REPLICA IDENTITY FULL;`)
    console.log('   ✅ public.tickets replica identity set to FULL.')
  } catch (err) {
    console.error('   ❌ Error setting replica identity:', err.message)
  }

  await client.end()
  console.log('\n🚀 Database migration V21 complete!')
}

run().catch((err) => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})

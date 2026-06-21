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

  // 1. Create knowledge_base table
  console.log('🛠️ Creating knowledge_base table...')
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.knowledge_base (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_url TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `)
  console.log('   ✅ Table public.knowledge_base ready')

  // 2. Disable RLS and grant permissions
  console.log('🛡️ Configuring security and permissions...')
  await client.query(`ALTER TABLE public.knowledge_base DISABLE ROW LEVEL SECURITY;`)
  await client.query(`GRANT ALL ON TABLE public.knowledge_base TO postgres, service_role, anon, authenticated;`)
  console.log('   ✅ RLS disabled and permissions granted')

  // 3. Create full-text GIN index for search optimizations
  console.log('🔍 Creating search indices...')
  await client.query(`
    CREATE INDEX IF NOT EXISTS knowledge_base_content_fts_idx 
    ON public.knowledge_base 
    USING gin(to_tsvector('english', content));
  `)
  console.log('   ✅ GIN search index ready')

  await client.end()
  console.log('\n🚀 Database migration V5 complete!')
}

run().catch((err) => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})

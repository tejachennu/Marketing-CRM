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

  console.log('🛠️ Creating tables...')
  
  // 1. message_templates
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.message_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'MARKETING',
      language TEXT NOT NULL DEFAULT 'en',
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'APPROVED',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
  console.log('   - message_templates table ready')

  // 2. campaigns
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.campaigns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      template_id UUID REFERENCES public.message_templates(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      total_contacts INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
  console.log('   - campaigns table ready')

  // 3. campaign_logs
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.campaign_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
      phone_number TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      variables_mapped JSONB,
      message_sid TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
  console.log('   - campaign_logs table ready')

  console.log('\n🔓 Disabling RLS & Granting Access...')
  
  const tables = ['message_templates', 'campaigns', 'campaign_logs']
  for (const table of tables) {
    await client.query(`ALTER TABLE public."${table}" DISABLE ROW LEVEL SECURITY`)
    await client.query(`GRANT ALL ON public."${table}" TO anon`)
    await client.query(`GRANT ALL ON public."${table}" TO authenticated`)
    console.log(`   - RLS disabled & privileges granted on ${table}`)
  }

  console.log('\n🌱 Seeding default templates...')
  const templates = [
    {
      name: 'welcome_campaign',
      category: 'UTILITY',
      body: 'Hello {{1}}, welcome to {{2}}! We are thrilled to have you onboard.',
    },
    {
      name: 'promotion_discount',
      category: 'MARKETING',
      body: 'Hey {{1}}! Get {{2}}% off on all our services this weekend. Use code {{3}} at checkout.',
    },
    {
      name: 'follow_up_lead',
      category: 'UTILITY',
      body: 'Hi {{1}}, this is {{2}} from {{3}}. Just following up on our previous conversation regarding your inquiry. Let us know if you have any questions!',
    },
  ]

  for (const t of templates) {
    await client.query(`
      INSERT INTO public.message_templates (name, category, body, status)
      VALUES ($1, $2, $3, 'APPROVED')
      ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body
    `, [t.name, t.category, t.body])
    console.log(`   - Seeded/Updated template: ${t.name}`)
  }

  await client.end()
  console.log('\n🎉 Migration complete successfully!')
}

run().catch((err) => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})

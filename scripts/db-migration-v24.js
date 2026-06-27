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

  console.log('🛠️ Adding see_all and read_only columns to users table...')
  
  // 1. Add see_all column
  await client.query(`
    ALTER TABLE public.users 
    ADD COLUMN IF NOT EXISTS see_all BOOLEAN DEFAULT false;
  `)
  console.log('   ✅ Column see_all created')

  // 2. Add read_only column
  await client.query(`
    ALTER TABLE public.users 
    ADD COLUMN IF NOT EXISTS read_only BOOLEAN DEFAULT false;
  `)
  console.log('   ✅ Column read_only created')

  // 3. Set see_all = true for all admin roles
  await client.query(`
    UPDATE public.users 
    SET see_all = true 
    WHERE role IN ('owner', 'admin', 'OrgAdmin', 'superadmin');
  `)
  console.log('   ✅ Set default see_all=true for admin roles')

  await client.end()
  console.log('\n🚀 Database migration V24 complete!')
}

run().catch((err) => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})

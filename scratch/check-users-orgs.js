const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

const workspaceEnvPath = path.join(__dirname, '..', '.env')
const envContent = fs.readFileSync(workspaceEnvPath, 'utf8')
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
  const cleanUrl = POSTGRES_URL.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]supa=[^&]*/g, '')
  const client = new Client({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  
  // Print all users
  const { rows: users } = await client.query('SELECT id, email, organization_id, full_name FROM public.users')
  console.log('📋 All users in db:')
  console.log(users)

  // Print all organizations
  const { rows: orgs } = await client.query('SELECT id, name, slug FROM public.organizations')
  console.log('\n📋 All organizations in db:')
  console.log(orgs)

  await client.end()
}

run().catch(console.error)

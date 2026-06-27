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

async function run() {
  const cleanUrl = POSTGRES_URL.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]supa=[^&]*/g, '')
  const client = new Client({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  
  // 1. Drop existing constraint
  console.log('Dropping existing users_role_check constraint...')
  await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check')
  
  // 2. Add new constraint allowing new and legacy roles
  console.log('Adding new users_role_check constraint...')
  const newConstraint = `
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
      role = ANY (ARRAY[
        'super_admin'::text, 'org_admin'::text, 'org_manager'::text, 'sales_employee'::text,
        'owner'::text, 'admin'::text, 'member'::text, 'agent'::text, 'viewer'::text,
        'salesemployees'::text, 'saleslead'::text, 'superadmin'::text, 'OrgAdmin'::text, 'Manager'::text
      ])
    )
  `
  await client.query(newConstraint)
  console.log('Constraint updated successfully!')

  await client.end()
}

run().catch(console.error)

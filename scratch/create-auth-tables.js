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
  
  // 1. Create login_otps table
  console.log('Creating login_otps table...')
  await client.query(`
    CREATE TABLE IF NOT EXISTS login_otps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `)
  
  // 2. Create password_setup_tokens table
  console.log('Creating password_setup_tokens table...')
  await client.query(`
    CREATE TABLE IF NOT EXISTS password_setup_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `)
  
  console.log('Tables created successfully!')
  await client.end()
}

run().catch(console.error)

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
  
  console.log('--- ORGANIZATIONS ---')
  const { rows: orgs } = await client.query('SELECT * FROM organizations')
  console.log(orgs)

  console.log('\n--- USERS ---')
  const { rows: users } = await client.query('SELECT * FROM users')
  console.log(users)

  console.log('\n--- CONTACTS ---')
  const { rows: contacts } = await client.query('SELECT * FROM contacts')
  console.log(contacts)

  console.log('\n--- CONVERSATIONS ---')
  const { rows: convs } = await client.query('SELECT * FROM conversations')
  console.log(convs)

  await client.end()
}

run().catch(console.error)

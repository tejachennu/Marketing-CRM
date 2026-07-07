const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

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

  console.log('--- 1. Checking knowledge_base columns ---')
  const { rows: columns } = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'knowledge_base'
  `)
  console.log(columns)

  console.log('\n--- 2. Checking articles count and null embeddings ---')
  const { rows: stats } = await client.query(`
    SELECT 
      COUNT(*) as total_articles,
      SUM(CASE WHEN embedding IS NULL THEN 1 ELSE 0 END) as null_embeddings
    FROM knowledge_base
  `)
  console.log(stats)

  console.log('\n--- 3. Printing sample articles ---')
  const { rows: samples } = await client.query(`
    SELECT id, title, organization_id, (embedding IS NOT NULL) as has_embedding
    FROM knowledge_base
    LIMIT 5
  `)
  console.log(samples)

  await client.end()
}

run().catch(console.error)

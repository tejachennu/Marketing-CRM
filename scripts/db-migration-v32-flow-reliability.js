const { loadEnvConfig } = require('@next/env')
const { Client } = require('pg')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
loadEnvConfig(process.cwd())
async function run() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('A PostgreSQL connection URL is required')
  const client = new Client({ connectionString })
  try {
    await client.connect()
    await client.query(readFileSync(join(__dirname, 'db-migration-v32-flow-reliability.sql'), 'utf8'))
    console.log('Flow reliability migration applied')
  } finally { await client.end() }
}
run().catch(error => { console.error(error.message); process.exitCode = 1 })

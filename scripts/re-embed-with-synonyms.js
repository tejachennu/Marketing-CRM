/**
 * Re-Embed Knowledge Base Articles with Synonym Enrichment
 * 
 * This script re-generates all embeddings for knowledge_base articles
 * by enriching the embedding text with synonym context from the 
 * organization's service_synonyms dictionary.
 * 
 * This ensures that articles like "Police Clearance Letter fee?" have 
 * embeddings that are close to queries using any synonym alias 
 * (PCC, Character Certificate, etc.)
 */

const { Client } = require('pg')
const fs = require('fs')

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

// Load env variables
const envContent = fs.readFileSync('D:\\new-chat\\.env', 'utf8')
const env = {}
envContent.split('\n').forEach((line) => {
  const match = line.match(/^([^=]+)=\s*'?(.*?)'?\s*$/)
  if (match) env[match[1].trim()] = match[2]
})

const POSTGRES_URL = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.DATABASE_URL
const OPENAI_API_KEY = env.OPENAI_API_KEY

function enrichTextWithSynonyms(title, content, synonyms) {
  const baseText = `${title}\n${content}`
  if (!synonyms || synonyms.length === 0) return baseText

  const combinedLower = `${title.toLowerCase()} ${content.toLowerCase()}`
  const matchedAliases = []

  for (const group of synonyms) {
    if (!group.canonical || !group.aliases || group.aliases.length === 0) continue

    const canonicalLower = group.canonical.toLowerCase().trim()
    let isMatched = false

    if (combinedLower.includes(canonicalLower)) {
      isMatched = true
    }

    if (!isMatched) {
      for (const alias of group.aliases) {
        if (!alias || alias.trim().length === 0) continue
        if (combinedLower.includes(alias.toLowerCase().trim())) {
          isMatched = true
          break
        }
      }
    }

    if (isMatched) {
      if (!combinedLower.includes(canonicalLower)) {
        matchedAliases.push(group.canonical)
      }
      for (const alias of group.aliases) {
        if (!alias || alias.trim().length === 0) continue
        if (!combinedLower.includes(alias.toLowerCase().trim())) {
          matchedAliases.push(alias.trim())
        }
      }
    }
  }

  if (matchedAliases.length === 0) return baseText
  return `${baseText}\n(Also known as: ${matchedAliases.join(', ')})`
}

async function generateEmbedding(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.substring(0, 8000)
    })
  })

  if (!res.ok) {
    console.error(`Embedding API error: ${res.status} ${await res.text()}`)
    return null
  }

  const data = await res.json()
  return data.data?.[0]?.embedding || null
}

async function run() {
  const client = new Client({
    connectionString: POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  })

  await client.connect()
  console.log('Connected to database.')

  // Get all organizations with their synonyms
  const { rows: orgs } = await client.query(`
    SELECT id, name, service_synonyms
    FROM organizations
    WHERE service_synonyms IS NOT NULL
  `)

  for (const org of orgs) {
    const synonyms = org.service_synonyms || []
    if (synonyms.length === 0) {
      console.log(`Org "${org.name}" has no synonyms, skipping.`)
      continue
    }

    console.log(`\nProcessing org: "${org.name}" (${synonyms.length} synonym groups)`)

    // Get all articles for this org
    const { rows: articles } = await client.query(`
      SELECT id, title, content
      FROM knowledge_base
      WHERE organization_id = $1
    `, [org.id])

    console.log(`Found ${articles.length} articles to re-embed.`)

    let updated = 0
    let enriched = 0
    let failed = 0

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i]
      const textToEmbed = enrichTextWithSynonyms(article.title, article.content || '', synonyms)
      const wasEnriched = textToEmbed !== `${article.title}\n${article.content || ''}`

      if (wasEnriched) enriched++

      // Generate new embedding
      const embedding = await generateEmbedding(textToEmbed)
      if (!embedding) {
        console.error(`  FAILED: "${article.title}"`)
        failed++
        continue
      }

      // Update the embedding in the database
      const embeddingStr = `[${embedding.join(',')}]`
      await client.query(`
        UPDATE knowledge_base 
        SET embedding = $1::vector 
        WHERE id = $2
      `, [embeddingStr, article.id])

      updated++

      // Progress logging every 25 articles
      if ((i + 1) % 25 === 0 || i === articles.length - 1) {
        console.log(`  Progress: ${i + 1}/${articles.length} (${enriched} enriched, ${failed} failed)`)
      }

      // Rate limiting: sleep 100ms between API calls to avoid hitting limits
      await new Promise(r => setTimeout(r, 100))
    }

    console.log(`\nDone for "${org.name}": ${updated} updated, ${enriched} synonym-enriched, ${failed} failed`)
  }

  await client.end()
  console.log('\nAll done! Re-embedding complete.')
}

run().catch(console.error)

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach((line) => {
  const match = line.match(/^([^=]+)=\s*'?(.*?)'?\s*$/)
  if (match) env[match[1].trim()] = match[2]
})

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const openAiKey = env.OPENAI_API_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase config')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const orgId = '303b7a2d-281c-403c-b794-54d1e195ca69' // from previous step

async function run() {
  const query = 'Can I apply for PR extension without valid passport?'
  console.log(`Query: "${query}"`)
  
  // 1. Get embedding
  console.log('Generating embedding via OpenAI...')
  const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAiKey}`
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: query
    })
  })
  
  if (!embedRes.ok) {
    console.error('Failed to generate embedding:', await embedRes.text())
    return
  }
  
  const embedData = await embedRes.json()
  const embedding = embedData.data?.[0]?.embedding
  console.log(`Embedding dimension: ${embedding.length}`)
  
  // 2. Call RPC match_faqs
  console.log('\nCalling match_faqs RPC with threshold 0.60...')
  const { data: matchedFaqs, error: rpcError } = await supabase.rpc('match_faqs', {
    query_embedding: `[${embedding.join(',')}]`,
    match_threshold: 0.60,
    match_count: 3,
    org_id: orgId
  })
  
  if (rpcError) {
    console.error('match_faqs RPC Error:', rpcError)
  } else {
    console.log(`match_faqs returned ${matchedFaqs.length} results:`)
    console.log(matchedFaqs.map(f => ({ title: f.title, similarity: f.similarity })))
  }

  // 3. Call RPC match_faqs with lower threshold
  console.log('\nCalling match_faqs RPC with threshold 0.30...')
  const { data: matchedFaqsLow, error: rpcErrorLow } = await supabase.rpc('match_faqs', {
    query_embedding: `[${embedding.join(',')}]`,
    match_threshold: 0.30,
    match_count: 3,
    org_id: orgId
  })
  
  if (rpcErrorLow) {
    console.error('match_faqs RPC (low) Error:', rpcErrorLow)
  } else {
    console.log(`match_faqs (low) returned ${matchedFaqsLow.length} results:`)
    console.log(matchedFaqsLow.map(f => ({ title: f.title, similarity: f.similarity })))
  }
}

run().catch(console.error)

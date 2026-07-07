import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyOrgAccess } from '@/lib/api-auth-helper'
import { SynonymGroup } from '@/lib/query-expander'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

async function generateEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.substring(0, 8000)
      })
    })

    if (!res.ok) {
      console.error('[Re-Embed] Embedding API error:', res.status)
      return null
    }

    const data = await res.json()
    return data.data?.[0]?.embedding || null
  } catch (err) {
    console.error('[Re-Embed] Error generating embedding:', err)
    return null
  }
}

/**
 * Enrich embedding text with synonym aliases so the vector captures all terms in the bucket.
 */
function enrichTextWithSynonyms(title: string, content: string, synonyms: SynonymGroup[]): string {
  const baseText = `${title}\n${content}`
  if (!synonyms || synonyms.length === 0) return baseText

  const combinedLower = `${title.toLowerCase()} ${content.toLowerCase()}`
  const matchedAliases: string[] = []

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

/**
 * Check if an article's title/content matches any term in a synonym group
 */
function articleMatchesGroup(title: string, content: string, group: SynonymGroup): boolean {
  const combinedLower = `${title.toLowerCase()} ${(content || '').toLowerCase()}`
  
  // Check canonical
  if (combinedLower.includes(group.canonical.toLowerCase().trim())) {
    return true
  }
  
  // Check aliases
  for (const alias of group.aliases) {
    if (!alias || alias.trim().length === 0) continue
    if (combinedLower.includes(alias.toLowerCase().trim())) {
      return true
    }
  }
  
  return false
}

/**
 * POST /api/knowledge/re-embed
 * 
 * Re-generates embeddings ONLY for articles affected by a specific synonym group change.
 * Called automatically when synonyms are added, updated, or deleted.
 * 
 * Request body: 
 *   { organizationId: string, changedGroup: SynonymGroup }  — re-embed only affected articles
 *   { organizationId: string, oldGroup: SynonymGroup }      — when a group is deleted, re-embed its articles without that synonym context
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId, changedGroup, oldGroup } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const authResult = await verifyOrgAccess(request, organizationId)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const supabase = getSupabaseClient()

    // Load organization settings (full synonyms list + OpenAI key)
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('service_synonyms, openai_api_key')
      .eq('id', organizationId)
      .maybeSingle()

    if (orgError) throw orgError

    const allSynonyms: SynonymGroup[] = orgData?.service_synonyms || []
    const openAiKey = orgData?.openai_api_key || process.env.OPENAI_API_KEY || ''

    if (!openAiKey) {
      return NextResponse.json({ error: 'No OpenAI API key configured' }, { status: 400 })
    }

    // Fetch all articles for this organization
    const { data: allArticles, error: articlesError } = await supabase
      .from('knowledge_base')
      .select('id, title, content')
      .eq('organization_id', organizationId)

    if (articlesError) throw articlesError
    if (!allArticles || allArticles.length === 0) {
      return NextResponse.json({ success: true, total: 0, updated: 0, enriched: 0, failed: 0 })
    }

    // Determine which group to use for filtering affected articles
    // Use changedGroup (add/edit) or oldGroup (delete) — whichever is provided
    const targetGroup: SynonymGroup | null = changedGroup || oldGroup || null

    // Filter to only articles affected by the changed synonym group
    let articlesToProcess = allArticles
    if (targetGroup) {
      articlesToProcess = allArticles.filter(article => 
        articleMatchesGroup(article.title, article.content || '', targetGroup)
      )
    }

    if (articlesToProcess.length === 0) {
      console.log(`[Re-Embed] No articles affected by synonym change in org ${organizationId}`)
      return NextResponse.json({ success: true, total: 0, updated: 0, enriched: 0, failed: 0 })
    }

    console.log(`[Re-Embed] Re-embedding ${articlesToProcess.length}/${allArticles.length} affected articles for org ${organizationId}`)

    let updated = 0
    let enriched = 0
    let failed = 0

    for (const article of articlesToProcess) {
      // Re-generate embedding with the CURRENT (latest) full synonym list
      const textToEmbed = enrichTextWithSynonyms(article.title, article.content || '', allSynonyms)
      const wasEnriched = textToEmbed !== `${article.title}\n${article.content || ''}`
      if (wasEnriched) enriched++

      const embedding = await generateEmbedding(textToEmbed, openAiKey)
      if (!embedding) {
        failed++
        continue
      }

      const embeddingStr = `[${embedding.join(',')}]`
      try {
        await supabase.rpc('update_faq_embedding', {
          faq_id: article.id,
          new_embedding: embeddingStr
        })
        updated++
      } catch (rpcErr) {
        console.error(`[Re-Embed] Failed to update embedding for "${article.title}":`, rpcErr)
        failed++
      }
    }

    console.log(`[Re-Embed] Complete: ${updated}/${articlesToProcess.length} updated, ${enriched} enriched, ${failed} failed`)

    return NextResponse.json({
      success: true,
      total: articlesToProcess.length,
      updated,
      enriched,
      failed
    })
  } catch (error: any) {
    console.error('[Re-Embed] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

import { SynonymGroup } from '@/lib/query-expander'

/**
 * Generate embedding for a query using OpenAI text-embedding-3-small
 * [AI-Shared]
 * @param text The text to embed
 * @param apiKey The OpenAI API Key
 * @returns The generated embedding array or null on error
 */
export async function generateQueryEmbedding(text: string, apiKey: string): Promise<number[] | null> {
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
      console.error('[AI-Shared] Embedding API error:', res.status)
      return null
    }

    const data = await res.json()
    return data.data?.[0]?.embedding || null
  } catch (err) {
    console.error('[AI-Shared] Error generating query embedding:', err)
    return null
  }
}

/**
 * Fallback keyword search for when vector search is not yet available.
 * [AI-Shared]
 * @param supabase The Supabase client instance
 * @param queryText The query to search for
 * @param orgId The organization ID
 * @returns An array of matched knowledge base items
 */
export async function fallbackKeywordSearch(
  supabase: any,
  queryText: string,
  orgId: string
): Promise<{ title: string; content: string; similarity: number }[]> {
  try {
    // 1. Search title column first (since it matches user question headers directly)
    const { data: titleMatches } = await supabase
      .from('knowledge_base')
      .select('title, content')
      .eq('organization_id', orgId)
      .textSearch('title', queryText, { config: 'english', type: 'websearch' })
      .limit(3)

    // 2. Search content column (for detail matches)
    const { data: contentMatches } = await supabase
      .from('knowledge_base')
      .select('title, content')
      .eq('organization_id', orgId)
      .textSearch('content', queryText, { config: 'english', type: 'websearch' })
      .limit(3)

    // 3. Combine and deduplicate, prioritizing title matches
    const merged: any[] = []
    const seen = new Set<string>()

    if (titleMatches) {
      for (const item of titleMatches) {
        const titleLower = item.title.toLowerCase().trim()
        if (!seen.has(titleLower)) {
          seen.add(titleLower)
          merged.push({ title: item.title, content: item.content, similarity: 0 })
        }
      }
    }

    if (contentMatches) {
      for (const item of contentMatches) {
        const titleLower = item.title.toLowerCase().trim()
        if (!seen.has(titleLower)) {
          seen.add(titleLower)
          merged.push({ title: item.title, content: item.content, similarity: 0 })
        }
      }
    }

    if (merged.length > 0) {
      return merged.slice(0, 3)
    }
  } catch (err) {
    console.error('[AI-Shared] [Keyword Search] Websearch failed, trying ILIKE:', err)
  }

  // 4. Final fallback: ILIKE on both title and content
  try {
    const rawWords = queryText
      .replace(/OR/g, ' ')
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w: string) => w.length > 2)

    if (rawWords.length > 0) {
      const ilikeFilters = rawWords.flatMap((w: string) => [
        `content.ilike.%${w}%`,
        `title.ilike.%${w}%`
      ])
      const { data: fallbackKb } = await supabase
        .from('knowledge_base')
        .select('title, content')
        .eq('organization_id', orgId)
        .or(ilikeFilters.join(','))
        .limit(3)

      return (fallbackKb || []).map((a: any) => ({ title: a.title, content: a.content, similarity: 0 }))
    }
  } catch (e) {
    console.error('[AI-Shared] [Keyword Search] ILIKE fallback search failed:', e)
  }

  return []
}

/**
 * Enrich embedding text with synonym aliases so the vector captures all terms in the bucket.
 * [AI-Shared]
 * @param title The title of the article
 * @param content The content of the article
 * @param synonyms The synonym groups configured for the organization
 * @returns The enriched text string
 */
export function enrichTextWithSynonyms(title: string, content: string, synonyms: SynonymGroup[]): string {
  const baseText = `${title}\n${content}`
  if (!synonyms || synonyms.length === 0) return baseText

  const titleLower = title.toLowerCase()
  const contentLower = content.toLowerCase()
  const combinedLower = `${titleLower} ${contentLower}`
  const matchedAliases: string[] = []

  for (const group of synonyms) {
    if (!group.canonical || !group.aliases || group.aliases.length === 0) continue

    const canonicalLower = group.canonical.toLowerCase().trim()
    let isMatched = false

    // Check if canonical term appears in title or content
    if (combinedLower.includes(canonicalLower)) {
      isMatched = true
    }

    // Check if any alias appears in title or content
    if (!isMatched) {
      for (const alias of group.aliases) {
        if (!alias || alias.trim().length === 0) continue
        if (combinedLower.includes(alias.toLowerCase().trim())) {
          isMatched = true
          break
        }
      }
    }

    // If matched, collect all terms from this synonym group
    if (isMatched) {
      // Add canonical if not already in text
      if (!combinedLower.includes(canonicalLower)) {
        matchedAliases.push(group.canonical)
      }
      // Add all aliases not already in text
      for (const alias of group.aliases) {
        if (!alias || alias.trim().length === 0) continue
        if (!combinedLower.includes(alias.toLowerCase().trim())) {
          matchedAliases.push(alias.trim())
        }
      }
    }
  }

  if (matchedAliases.length === 0) return baseText

  // Append synonym context as a parenthetical note
  const synonymContext = `(Also known as: ${matchedAliases.join(', ')})`
  console.log(`[AI-Shared] Enriching embedding for "${title}" with ${matchedAliases.length} synonym terms`)
  return `${baseText}\n${synonymContext}`
}

/**
 * Builds the complete system prompt for the chatbot, combining instructions, FAQs, and terminology contexts.
 * [AI-Shared]
 * @param basePrompt The base default instructions
 * @param faqContext The formatted FAQ items matched
 * @param synonymContext The terminology note regarding synonyms
 * @param conversationInstruction Optional conversation history or specific instructions
 * @returns The comprehensive system prompt string
 */
export function buildChatbotSystemPrompt(
  basePrompt: string, 
  faqContext: string, 
  synonymContext: string, 
  conversationInstruction?: string
): string {
  let prompt = `${basePrompt}

MATCHED FAQ ARTICLES FROM KNOWLEDGE BASE (Use this as your source of truth):
${faqContext || '(No matching FAQs found in the knowledge base)'}${synonymContext}
`

  if (conversationInstruction) {
    prompt += `\nCONVERSATION HISTORY:\n${conversationInstruction}\n`
  }

  prompt += `
CRITICAL INSTRUCTIONS:
You MUST respond in JSON format. The JSON object must contain two keys:
1. "reply": (string) Your natural conversational reply to the customer. If you cannot answer the query using the matched FAQ articles, or if the user asks to connect with support/a human, or if you need to hand off to a human agent, set "reply" to a friendly notice indicating that the support team will get in touch soon.
2. "isRiseTicket": (boolean) Set this to true ONLY if you cannot answer the user's question, if they explicitly ask for human/agent/support assistance, if they are reporting a bug or raising an issue that requires agent intervention, or if you are giving the fallback reply. Otherwise, set it to false.`

  return prompt
}

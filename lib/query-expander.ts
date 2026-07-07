/**
 * Query Expansion via Synonym Dictionary
 * 
 * Expands user queries by replacing recognized service aliases with their
 * canonical terms before RAG search (embedding generation + keyword search).
 * 
 * This ensures that queries like "Police Clearance Letter fee?" match 
 * knowledge base articles titled "PCC fee" by appending "PCC" to the query.
 */

export interface SynonymGroup {
  canonical: string
  aliases: string[]
}

/**
 * Expands a user query by appending canonical terms when alias matches are found.
 * 
 * Strategy:
 * 1. Sort aliases by length (longest first) to avoid partial matches
 * 2. Case-insensitive matching with word boundary awareness
 * 3. Append matched canonical terms to the end of the query
 * 4. Return both the expanded query and metadata about what was matched
 * 
 * @param query - The original user query
 * @param synonyms - Array of synonym groups from organization settings
 * @returns Object with expandedQuery string and matchedSynonyms array
 */
export function expandQueryWithSynonyms(
  query: string,
  synonyms: SynonymGroup[]
): {
  expandedQuery: string
  vectorQuery: string
  keywordQuery: string
  matchedSynonyms: { alias: string; canonical: string }[]
} {
  if (!synonyms || synonyms.length === 0 || !query.trim()) {
    return {
      expandedQuery: query,
      vectorQuery: query,
      keywordQuery: query,
      matchedSynonyms: []
    }
  }

  const queryLower = query.toLowerCase()
  const matchedSynonyms: { alias: string; canonical: string }[] = []
  const canonicalsToAppend = new Set<string>()
  const aliasesToAppend = new Set<string>()

  for (const group of synonyms) {
    if (!group.canonical || !group.aliases || group.aliases.length === 0) continue

    const canonicalLower = group.canonical.toLowerCase().trim()
    let isMatched = false
    let matchedAliasName = ''

    // 1. Check if canonical term is in query
    if (queryLower.includes(canonicalLower)) {
      isMatched = true
      matchedAliasName = group.canonical // Matched via canonical itself
    }

    // 2. Check if any alias is in query
    const sortedAliases = [...group.aliases].sort((a, b) => b.length - a.length)
    for (const alias of sortedAliases) {
      if (!alias || alias.trim().length === 0) continue
      const aliasLower = alias.toLowerCase().trim()

      if (queryLower.includes(aliasLower)) {
        isMatched = true
        matchedAliasName = alias.trim()
        break
      }
    }

    // 3. If matched, expand query
    if (isMatched) {
      matchedSynonyms.push({ alias: matchedAliasName, canonical: group.canonical })
      
      // Append canonical if not already in query
      if (!queryLower.includes(canonicalLower)) {
        canonicalsToAppend.add(group.canonical)
      }

      // Append up to 3 descriptive aliases to enrich the embedding/search context
      let appendedCount = 0
      for (const alias of sortedAliases) {
        if (appendedCount >= 3) break
        const aliasLower = alias.toLowerCase().trim()
        if (!queryLower.includes(aliasLower)) {
          aliasesToAppend.add(alias.trim())
          appendedCount++
        }
      }
    }
  }

  if (canonicalsToAppend.size === 0 && aliasesToAppend.size === 0) {
    return {
      expandedQuery: query,
      vectorQuery: query,
      keywordQuery: query,
      matchedSynonyms: []
    }
  }

  // 1. Natural language query for vector embeddings
  // Include both canonical and key aliases to match synonym-enriched article embeddings
  const vectorTerms: string[] = []
  if (canonicalsToAppend.size > 0) {
    vectorTerms.push(...Array.from(canonicalsToAppend))
  }
  if (aliasesToAppend.size > 0) {
    vectorTerms.push(...Array.from(aliasesToAppend))
  }
  const vectorQuery = vectorTerms.length > 0
    ? `${query.trim()}, ${vectorTerms.join(', ')}`
    : query.trim()

  // 2. Websearch syntax query for full-text keyword search
  const keywordTerms: string[] = []
  if (canonicalsToAppend.size > 0) {
    keywordTerms.push(Array.from(canonicalsToAppend).map(c => `"${c}"`).join(' OR '))
  }
  if (aliasesToAppend.size > 0) {
    keywordTerms.push(Array.from(aliasesToAppend).map(a => `"${a}"`).join(' OR '))
  }
  const keywordQuery = `${query.trim()} OR ${keywordTerms.join(' OR ')}`

  return {
    expandedQuery: vectorQuery,
    vectorQuery,
    keywordQuery,
    matchedSynonyms
  }
}

/**
 * Helper to identify which synonym terms from active groups are actually present
 * in the combined user query and matched FAQ text context. Only returns relationships
 * where at least 2 distinct terms are present, to keep prompts clean and context-filtered.
 */
export function getActiveSynonymRelationships(
  query: string,
  faqsText: string,
  synonyms: SynonymGroup[]
): string[] {
  const combinedText = `${query} ${faqsText}`.toLowerCase()
  const relationships: string[] = []

  for (const group of synonyms) {
    if (!group.canonical || !group.aliases) continue

    const presentTerms = new Set<string>()

    // Check if canonical term is present
    const canonicalLower = group.canonical.toLowerCase().trim()
    if (combinedText.includes(canonicalLower)) {
      presentTerms.add(group.canonical.trim())
    }

    // Check which aliases are present
    for (const alias of group.aliases) {
      if (!alias || alias.trim().length === 0) continue
      const aliasLower = alias.toLowerCase().trim()
      if (combinedText.includes(aliasLower)) {
        presentTerms.add(alias.trim())
      }
    }

    // Only output a relationship if at least 2 distinct terms from the group are present
    if (presentTerms.size >= 2) {
      const termsArray = Array.from(presentTerms)
      relationships.push(
        `"${termsArray.slice(0, -1).join('", "')}" and "${termsArray[termsArray.length - 1]}" refer to the exact same concept/service`
      );
    }
  }

  return relationships
}

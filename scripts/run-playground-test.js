function getActiveSynonymRelationships(
  query,
  faqsText,
  synonyms
) {
  const combinedText = `${query} ${faqsText}`.toLowerCase()
  const relationships = []

  for (const group of synonyms) {
    if (!group.canonical || !group.aliases) continue

    const presentTerms = new Set()

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
      )
    }
  }

  return relationships
}

const synonyms = [
  {
    canonical: "PCC",
    aliases: [
      "Police Clearance Certificate",
      "Police Clearance Letter",
      "Character Certificate",
      "Good Conduct Certificate"
    ]
  },
  {
    canonical: "OCI",
    aliases: ["OCI Card", "Indian OCI"]
  }
]

console.log('=== TEST 1: PCC and Character Certificate both present ===')
const query1 = "Character Certificate is valid for ?"
const faqsText1 = "What is the validity of PCC issued from the Consulate? Answer: PCC has no fixed validity."
const relationships1 = getActiveSynonymRelationships(query1, faqsText1, synonyms)
console.log(relationships1)

console.log('\n=== TEST 2: Only PCC present (no relation should be output) ===')
const query2 = "PCC fee?"
const faqsText2 = "What is the fee for PCC? Answer: PCC fee is $40."
const relationships2 = getActiveSynonymRelationships(query2, faqsText2, synonyms)
console.log(relationships2)

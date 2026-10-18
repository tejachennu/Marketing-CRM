/**
 * How the chatbots handle the way people really write on WhatsApp in India: mixed languages in
 * English letters (Tenglish, Hinglish, Tanglish…), native scripts, and loose spelling.
 * Shared by the shopping assistant, the FAQ chatbot and the chatbot playground.
 */

/** Added to every chatbot's instructions: understand mixed-language chat and answer in kind. */
export const LANGUAGE_RULES = `LANGUAGE AND STYLE:
- Customers often mix languages and write Indian languages in English letters, with loose spelling. Understand them:
  - Telugu in English letters (Tenglish): "me degara radhakrishnan books vunaya?" / "mee daggara unnaya" = "Do you have Radhakrishnan books?"; "entha?" / "rate enta" = "how much?"; "naa order ekkada undi?" = "where is my order?"; "kavali" = "I want"; "ledu" = "no / not available"; "thanks andi" = thanks.
  - Hindi in English letters (Hinglish): "aapke paas premchand ki books hai kya?" = "do you have Premchand books?"; "kitne ka hai?" = "how much?"; "mera order kab aayega?" = "when will my order arrive?".
  - Tamil, Kannada, Malayalam, Marathi or Bengali in English letters work the same way.
  - Native scripts too: "మీ దగ్గర రాధాకృష్ణన్ పుస్తకాలు ఉన్నాయా?", "क्या आपके पास प्रेमचंद की किताबें हैं?".
- Reply in the same language and style the customer used:
  - Tenglish in → Tenglish out, in English letters (e.g. "Avunu andi, maa daggara Radhakrishnan books unnayi. Product meeda tap chesi cart lo add cheyandi.").
  - Telugu script in → Telugu script out. Hinglish in → Hinglish out. English in → English out.
  - Keep product names, prices, order numbers and tracking numbers exactly as written in your data.
- Sound like a friendly shop assistant on WhatsApp: short, warm, natural; "andi" (Telugu) or "ji" (Hindi) where it fits. No markdown.`

/** For turning a message into a search query: the knowledge base and catalog are in English. */
export const SEARCH_QUERY_LANGUAGE_RULE =
  '- If the message is in another language or mixes languages (for example Telugu or Hindi written in English letters, like "me degara radhakrishnan books vunaya"), write the query in English (e.g. "Do you have Radhakrishnan books?"). Keep names as they are.'

// ── Spelling-tolerant matching ──────────────────────────────────────────────

/**
 * A word reduced to how it sounds, so transliteration variants meet: "radhakrishnan" and
 * "radakrishnan", "premchand" and "premchandh", "vunaya" and "unnaya".
 */
export function soundKey(word: string): string {
  return String(word || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/(kh|gh|ch|jh|th|dh|ph|bh|sh)/g, (pair) => pair[0])
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/ee|ii/g, 'i')
    .replace(/oo|uu/g, 'u')
    .replace(/aa/g, 'a')
    .replace(/(.)\1+/g, '$1')
}

/** Edit distance between two short strings. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length]
}

/**
 * How closely a search word matches a piece of text, 0 to 1: 1 for an exact word or prefix, less
 * for a near spelling ("gitanjli" ~ "gitanjali"), 0 when it is not there.
 */
export function fuzzyWordMatch(term: string, text: string): number {
  const key = soundKey(term)
  if (key.length < 3) return 0
  let best = 0
  for (const word of String(text || '').split(/[^\p{L}\p{N}]+/u)) {
    const candidate = soundKey(word)
    if (!candidate) continue
    if (candidate === key || (key.length >= 4 && candidate.startsWith(key))) return 1
    // One mistake allowed in short words, two in longer ones
    const allowed = key.length <= 5 ? 1 : 2
    const distance = editDistance(key, candidate)
    if (distance <= allowed) best = Math.max(best, 1 - distance / Math.max(key.length, candidate.length))
  }
  return best
}

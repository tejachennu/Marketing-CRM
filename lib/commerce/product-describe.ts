/**
 * "Write with AI": a product's name, description and category from its photo. The prompt and the
 * answer's checks are here (pure); the route makes the call and charges it to the AI wallet.
 */

export const DESCRIBE_LANGUAGES = ['English', 'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati'] as const

export function describePrompt(input: { title?: string; category?: string; shop?: string; language?: string }): string {
  const language = (DESCRIBE_LANGUAGES as readonly string[]).includes(String(input.language)) ? input.language : 'English'
  return [
    `You write product listings for a small Indian online shop${input.shop ? ` called "${String(input.shop).slice(0, 80)}"` : ''}.`,
    'Look at the photo and write what a shopper needs: what it is, what it is made of, colour, size or quantity when you can see them, and what it is good for.',
    'Use simple, friendly words. Do not invent facts you cannot see (no brand, weight, price or offers unless they are written on the product). No emojis, no hashtags.',
    input.title ? `The shop calls it: "${String(input.title).slice(0, 150)}".` : '',
    input.category ? `Category: "${String(input.category).slice(0, 60)}".` : '',
    `Write in ${language}.`,
    'Answer only with JSON: {"title": short product name (at most 80 characters), "description": 2 to 4 short sentences (at most 600 characters), "category": one or two words}.',
  ].filter(Boolean).join('\n')
}

/** The model's answer, checked and trimmed; null when it is not usable. */
export function readDescribeAnswer(raw: unknown): { title: string; description: string; category: string } | null {
  let data: any = raw
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim()) } catch { return null }
  }
  const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  const description = clean(data?.description, 600)
  if (!description) return null
  return { title: clean(data?.title, 80), description, category: clean(data?.category, 40) }
}

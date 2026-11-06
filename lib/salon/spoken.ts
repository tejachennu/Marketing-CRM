/**
 * Turning what is said at the counter into data: phone numbers spoken as words (English, Hindi,
 * Telugu, "double five"), India time, and matching spoken names to services, staff and customers.
 * Pure functions, shared by the server and the screens.
 */

// ── Phone numbers ────────────────────────────────────────────────────────────

const DIGIT_WORDS: Record<string, string> = {
  // English
  zero: '0', oh: '0', o: '0', one: '1', two: '2', to: '2', too: '2', three: '3', four: '4', for: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9',
  // Hindi (in English letters)
  shunya: '0', sunya: '0', ek: '1', do: '2', teen: '3', tin: '3', char: '4', chaar: '4', paanch: '5', panch: '5', pach: '5',
  chhe: '6', che: '6', chah: '6', chhah: '6', saat: '7', sat: '7', aath: '8', aat: '8', nau: '9', nao: '9',
  // Telugu (in English letters)
  sunna: '0', okati: '1', okkati: '1', rendu: '2', moodu: '3', mudu: '3', naalugu: '4', nalugu: '4', aidu: '5', ayidu: '5',
  aaru: '6', aru: '6', edu: '7', yedu: '7', enimidi: '8', enmidi: '8', tommidi: '9', thommidi: '9',
}
const REPEAT_WORDS: Record<string, number> = { double: 2, triple: 3, dabal: 2 }

/** An Indian mobile number from speech or digits ("nine eight seven six…", "98765 43210"), as +91XXXXXXXXXX. */
export function parseSpokenPhone(text: unknown): string | null {
  const tokens = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  let digits = ''
  let repeat = 1
  for (const token of tokens) {
    if (REPEAT_WORDS[token]) { repeat = REPEAT_WORDS[token]; continue }
    let chunk = ''
    if (/^\d+$/.test(token)) chunk = token
    else if (DIGIT_WORDS[token]) chunk = DIGIT_WORDS[token]
    else { repeat = 1; continue }
    digits += chunk.length === 1 ? chunk.repeat(repeat) : chunk
    repeat = 1
  }
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null
}

/** The last ten digits, for matching numbers stored in different formats. */
export function phoneKey(phone: unknown): string {
  return String(phone || '').replace(/\D/g, '').slice(-10)
}

// ── India time (Asia/Kolkata is UTC+5:30 all year) ──────────────────────────

const IST_OFFSET_MS = 330 * 60 * 1000

/** "2026-11-06" for a moment, in India. */
export function istDate(at: Date | string | number = Date.now()): string {
  const time = new Date(at).getTime()
  return Number.isFinite(time) ? new Date(time + IST_OFFSET_MS).toISOString().slice(0, 10) : ''
}

/** "17:30" for a moment, in India. */
export function istTime(at: Date | string | number): string {
  const time = new Date(at).getTime()
  return Number.isFinite(time) ? new Date(time + IST_OFFSET_MS).toISOString().slice(11, 16) : ''
}

/** A date and time in India ("2026-11-06", "17:30") as a moment. Null when either is not valid. */
export function fromIst(date: string, time = '00:00'): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null
  const [hours, minutes] = time.split(':').map(Number)
  if (hours > 23 || minutes > 59) return null
  const moment = new Date(`${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+05:30`)
  return Number.isNaN(moment.getTime()) ? null : moment
}

/** The start and end of a day in India, as ISO strings, for database filters. */
export function istDayRange(date: string): { start: string; end: string } {
  const start = fromIst(date) || fromIst(istDate())!
  return { start: start.toISOString(), end: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString() }
}

export function addDays(date: string, days: number): string {
  const start = fromIst(date) || fromIst(istDate())!
  return istDate(start.getTime() + days * 24 * 60 * 60 * 1000)
}

/** "5:30 pm" */
export function formatIstTime(at: Date | string | number): string {
  const clock = istTime(at)
  if (!clock) return ''
  const [hours, minutes] = clock.split(':').map(Number)
  const suffix = hours >= 12 ? 'pm' : 'am'
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`
}

/** "Today", "Tomorrow", or "Sat, 8 Nov" */
export function formatIstDay(date: string, today = istDate()): string {
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  if (date === addDays(today, -1)) return 'Yesterday'
  const moment = fromIst(date, '12:00')
  return moment ? moment.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : date
}

/** Times to offer for a booking: every 30 minutes from now (or 10 am on a later day) until 9 pm. */
export function bookingSlots(date: string, now = Date.now(), openHour = 10, closeHour = 21): string[] {
  const slots: string[] = []
  const today = istDate(now)
  for (let minutes = openHour * 60; minutes <= closeHour * 60; minutes += 30) {
    const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    // Today: only times from about now on
    if (date === today && Date.parse(`${date}T${time}:00+05:30`) < now - 15 * 60 * 1000) continue
    slots.push(time)
  }
  return date < today ? [] : slots
}

// ── Matching spoken names ────────────────────────────────────────────────────

export function normalizeName(value: unknown): string {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** How well a spoken name matches a known one, 0 to 1. */
export function nameScore(spoken: unknown, known: unknown): number {
  const a = normalizeName(spoken)
  const b = normalizeName(known)
  if (!a || !b) return 0
  if (a === b) return 1
  if (b.startsWith(a) || a.startsWith(b)) return 0.9
  if (b.includes(a) || a.includes(b)) return 0.8
  const aWords = new Set(a.split(' '))
  const bWords = b.split(' ')
  const shared = bWords.filter((word) => aWords.has(word) || [...aWords].some((spokenWord) => spokenWord.length > 3 && (word.startsWith(spokenWord) || spokenWord.startsWith(word)))).length
  return shared ? 0.5 + 0.3 * (shared / Math.max(aWords.size, bWords.length)) : 0
}

/**
 * The known entry a spoken name refers to. One clear best match is returned as `match`; several
 * close ones come back as `choices` for the counter to tap; nothing close returns neither.
 */
export function matchByName<T>(spoken: unknown, candidates: T[], nameOf: (candidate: T) => string, threshold = 0.5): { match: T | null; choices: T[] } {
  const scored = candidates
    .map((candidate) => ({ candidate, score: nameScore(spoken, nameOf(candidate)) }))
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score)
  if (scored.length === 0) return { match: null, choices: [] }
  const best = scored[0]
  const close = scored.filter((entry) => best.score - entry.score < 0.1)
  if (close.length === 1 || best.score === 1 && (scored[1]?.score ?? 0) < 1) return { match: best.candidate, choices: [] }
  return { match: null, choices: close.slice(0, 6).map((entry) => entry.candidate) }
}
